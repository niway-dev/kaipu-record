import { useEffect, useState } from "react";
import type { AppSettings, ShortcutAction } from "@shared/types";
import { formatAccelerator } from "./keyboard-accelerator";

export type ShortcutLabels = Record<ShortcutAction, string>;

/**
 * The current global-shortcut bindings as display labels (e.g. "⌃⌘C"), for hints
 * shown around the UI. Queries settings on mount and subscribes to changes, so a
 * rebind on the Shortcuts page is reflected everywhere — including the floating
 * control-bar window, which is shown with `showInactive()` and kept alive across
 * recordings, so it never remounts or regains focus (the old focus-refresh never
 * fired there, leaving a stale Stop-shortcut hint). `null` until the first read.
 */
export function useShortcutLabels(): ShortcutLabels | null {
  const [labels, setLabels] = useState<ShortcutLabels | null>(null);

  useEffect(() => {
    const apply = (settings: AppSettings): void =>
      setLabels({
        startRecording: formatAccelerator(settings.shortcuts.startRecording),
        stopRecording: formatAccelerator(settings.shortcuts.stopRecording),
        bringToFront: formatAccelerator(settings.shortcuts.bringToFront),
        captureScreenshot: formatAccelerator(settings.shortcuts.captureScreenshot),
        toggleMicrophone: formatAccelerator(settings.shortcuts.toggleMicrophone),
        toggleSystemAudio: formatAccelerator(settings.shortcuts.toggleSystemAudio),
        toggleCamera: formatAccelerator(settings.shortcuts.toggleCamera),
      });
    void window.electronAPI.getSettings().then(apply);
    return window.electronAPI.onSettingsChanged(apply);
  }, []);

  return labels;
}
