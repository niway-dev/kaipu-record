import { useCallback, useEffect, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { CaptureWidgetSettings } from "@shared/capture-widget-settings";
import type { CaptureIntent } from "@shared/types/screenshot-capture";
import {
  getSettingsSnapshot,
  loadSettings,
  subscribeSettings,
  useSettings,
} from "@renderer/features/settings/settings-store";
import type { AppSettings } from "@shared/types";

export interface WidgetExpanded {
  /** The toolbar shows labels, switches and the size readout for the current capture type. */
  expanded: boolean;
  /** Flip compact and expanded for the current capture type, and remember it. */
  toggle(): void;
}

const pickWidget = (settings: AppSettings): CaptureWidgetSettings => settings.captureWidget;
const sameWidget = (a: CaptureWidgetSettings, b: CaptureWidgetSettings): boolean =>
  a.screenshotExpanded === b.screenshotExpanded && a.recordingExpanded === b.recordingExpanded;

type WidgetKey = keyof CaptureWidgetSettings;

/** Screenshots and recordings each remember their own mode (NIW2-883). */
const keyFor = (intent: CaptureIntent): WidgetKey =>
  intent === "record" ? "recordingExpanded" : "screenshotExpanded";

/**
 * Compact or expanded for the overlay's current intent, kept in `AppSettings.captureWidget`.
 * One overlay window per display mounts this: a toggle made in another window arrives as a
 * settings broadcast and this window follows it. A toggle made here shows at once and stands
 * until the store reports that value (main's echo), so a broadcast of an older change that is
 * still in flight cannot flip the toolbar back for a moment.
 */
export function useWidgetExpanded(
  api: Pick<KaipuElectronAPI, "updateSettings">,
  intent: CaptureIntent,
): WidgetExpanded {
  const key = keyFor(intent);
  const stored = useSettings(pickWidget, sameWidget);
  const [pending, setPendingState] = useState<Partial<CaptureWidgetSettings>>({});
  // The same claims as `pending`, readable between renders: a second toggle that comes before
  // React renders must see the first one's value, not the store's.
  const claims = useRef<Partial<CaptureWidgetSettings>>({});
  const setPending = useCallback((next: Partial<CaptureWidgetSettings>): void => {
    claims.current = next;
    setPendingState(next);
  }, []);
  const expanded = pending[key] ?? stored?.[key] ?? false;
  const latest = useRef({ key, expanded });
  latest.current = { key, expanded };
  // Saves run one after another, so the store sees the toggles in the order they were made.
  const saves = useRef<Promise<unknown>>(Promise.resolve());

  // Every value the store takes, not the rendered one: a pending toggle ends when the store
  // reaches it.
  useEffect(
    () =>
      subscribeSettings((published) => {
        const saved = published.captureWidget;
        const current = claims.current;
        let next = current;
        for (const name of Object.keys(current) as WidgetKey[]) {
          if (current[name] === saved?.[name]) {
            if (next === current) next = { ...current };
            delete next[name];
          }
        }
        if (next !== current) setPending(next);
      }),
    [setPending],
  );

  const toggle = useCallback((): void => {
    const { key: current, expanded: was } = latest.current;
    const next = !was;
    // Updated here too, so two taps before a render still flip twice.
    latest.current = { key: current, expanded: next };
    // What the other capture type still has in flight: it goes into this save, so the store's
    // older snapshot cannot undo it.
    const others = { ...claims.current };
    delete others[current];
    // Nothing stands over a value the store already holds: its later changes must show.
    const held = getSettingsSnapshot()?.captureWidget?.[current] ?? false;
    setPending(held === next ? others : { ...others, [current]: next });
    // The whole object is written back: the other capture type's value must stay.
    saves.current = saves.current
      .then(() => loadSettings())
      .then((app) =>
        api.updateSettings({ captureWidget: { ...app.captureWidget, ...others, [current]: next } }),
      )
      .catch(() => {
        // The save failed: show what the store holds again, unless a newer toggle has taken over.
        if (claims.current[current] !== next) return;
        const rest = { ...claims.current };
        delete rest[current];
        setPending(rest);
      });
  }, [api, setPending]);

  return { expanded, toggle };
}
