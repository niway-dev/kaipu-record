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
  const [pending, setPending] = useState<Partial<CaptureWidgetSettings>>({});
  const expanded = pending[key] ?? stored?.[key] ?? false;
  const latest = useRef({ key, expanded });
  latest.current = { key, expanded };

  // Every value the store takes, not the rendered one: a pending toggle ends when the store
  // reaches it.
  useEffect(
    () =>
      subscribeSettings((published) => {
        const saved = published.captureWidget;
        setPending((current) => {
          let next = current;
          for (const name of Object.keys(current) as WidgetKey[]) {
            if (current[name] === saved?.[name]) {
              if (next === current) next = { ...current };
              delete next[name];
            }
          }
          return next;
        });
      }),
    [],
  );

  const toggle = useCallback((): void => {
    const { key: current, expanded: was } = latest.current;
    const next = !was;
    // Updated here too, so two taps before a render still flip twice.
    latest.current = { key: current, expanded: next };
    // Nothing stands over a value the store already holds: its later changes must show.
    const held = getSettingsSnapshot()?.captureWidget?.[current] ?? false;
    setPending((previous) => {
      const rest = { ...previous };
      delete rest[current];
      return held === next ? rest : { ...rest, [current]: next };
    });
    // The whole object is written back: the other capture type's value must stay.
    void loadSettings()
      .then((app) =>
        api.updateSettings({ captureWidget: { ...app.captureWidget, [current]: next } }),
      )
      .catch(() => {});
  }, [api]);

  return { expanded, toggle };
}
