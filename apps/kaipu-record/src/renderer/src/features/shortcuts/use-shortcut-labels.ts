import { useMemo } from "react";
import type { AppSettings, ShortcutAction } from "@shared/types";
import { useSettings } from "@renderer/features/settings/settings-store";
import { formatAccelerator } from "./keyboard-accelerator";

export type ShortcutLabels = Record<ShortcutAction, string>;

const pickShortcuts = (settings: AppSettings): AppSettings["shortcuts"] => settings.shortcuts;

/** Whether two sets of bindings are the same accelerators (a broadcast sends a new object each time). */
function sameBindings(a: AppSettings["shortcuts"], b: AppSettings["shortcuts"]): boolean {
  return (Object.keys(a) as ShortcutAction[]).every((action) => a[action] === b[action]);
}

/**
 * The current global-shortcut bindings as display labels (e.g. "⌘⇧2"), for hints
 * shown around the UI. Reads the window's settings store and follows its changes, so a
 * rebind on the Shortcuts page is reflected everywhere — including the floating
 * control-bar window, which is shown with `showInactive()` and kept alive across
 * recordings, so it never remounts or regains focus (the old focus-refresh never
 * fired there, leaving a stale shortcut hint). `null` until the first read.
 */
export function useShortcutLabels(): ShortcutLabels | null {
  const shortcuts = useSettings(pickShortcuts, sameBindings);
  return useMemo(
    () =>
      shortcuts && {
        startRecording: formatAccelerator(shortcuts.startRecording),
        bringToFront: formatAccelerator(shortcuts.bringToFront),
        captureScreenshot: formatAccelerator(shortcuts.captureScreenshot),
        captureWindow: formatAccelerator(shortcuts.captureWindow),
        captureInstant: formatAccelerator(shortcuts.captureInstant),
      },
    [shortcuts],
  );
}
