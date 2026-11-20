import { useCallback, useEffect, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { CaptureWidgetSettings } from "@shared/capture-widget-settings";
import type { CaptureIntent } from "@shared/types/screenshot-capture";
import {
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
 * until the store reports the value of each save it made (main broadcasts once per save, in
 * order), so a broadcast of an older save that is still in flight cannot flip the toolbar for a
 * moment, not even when the newest toggle goes back to the value the store already holds.
 */
export function useWidgetExpanded(
  api: Pick<KaipuElectronAPI, "updateSettings">,
  intent: CaptureIntent,
): WidgetExpanded {
  const key = keyFor(intent);
  const stored = useSettings(pickWidget, sameWidget);
  const [pending, setPendingState] = useState<Partial<CaptureWidgetSettings>>({});
  // The saves of each type that main has not echoed yet, oldest first. A type's claim is its
  // newest save's value, and it ends only when the last of them is echoed. Kept in a ref so a
  // second toggle that comes before React renders sees the first one's value, not the store's.
  const saving = useRef<Partial<Record<WidgetKey, { id: number; value: boolean }[]>>>({});
  const lastId = useRef(0);
  const claims = useRef<Partial<CaptureWidgetSettings>>({});
  const publishClaims = useCallback((): void => {
    const next: Partial<CaptureWidgetSettings> = {};
    for (const name of Object.keys(saving.current) as WidgetKey[]) {
      const queue = saving.current[name];
      if (queue?.length) next[name] = queue[queue.length - 1].value;
    }
    claims.current = next;
    setPendingState(next);
  }, []);
  const expanded = pending[key] ?? stored?.[key] ?? false;
  const latest = useRef({ key, expanded });
  latest.current = { key, expanded };
  // Saves run one after another, so the store sees the toggles in the order they were made.
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  // Every value the store takes, not the rendered one: the oldest save of a type ends when the
  // store reaches its value. A value that is not that one (an older save's, another window's)
  // changes nothing here.
  useEffect(
    () =>
      subscribeSettings((published) => {
        let changed = false;
        for (const name of Object.keys(saving.current) as WidgetKey[]) {
          const queue = saving.current[name];
          if (queue?.length && queue[0].value === published.captureWidget?.[name]) {
            queue.shift();
            changed = true;
          }
        }
        if (changed) publishClaims();
      }),
    [publishClaims],
  );

  const toggle = useCallback((): void => {
    const { key: current, expanded: was } = latest.current;
    const next = !was;
    // Updated here too, so two taps before a render still flip twice.
    latest.current = { key: current, expanded: next };
    const mine = ++lastId.current;
    (saving.current[current] ??= []).push({ id: mine, value: next });
    publishClaims();
    // What the other capture type still has in flight: it goes into this save, so the store's
    // older snapshot cannot undo it.
    const others = { ...claims.current };
    delete others[current];
    // The whole object is written back: the other capture type's value must stay.
    writes.current = writes.current
      .then(() => loadSettings())
      .then((app) =>
        api.updateSettings({ captureWidget: { ...app.captureWidget, ...others, [current]: next } }),
      )
      .catch(() => {
        // The save failed and main will not echo it: stop waiting for it. The type shows its
        // newest save that is still out, or the stored value when none is.
        const queue = saving.current[current];
        const at = queue?.findIndex((save) => save.id === mine) ?? -1;
        if (queue && at >= 0) {
          queue.splice(at, 1);
          publishClaims();
        }
      });
  }, [api, publishClaims]);

  return { expanded, toggle };
}
