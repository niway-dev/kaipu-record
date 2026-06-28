import { useEffect, useState } from "react";
import type { ShortcutAction } from "@shared/types";
import { formatAccelerator } from "./keyboard-accelerator";

export type ShortcutLabels = Record<ShortcutAction, string>;

/**
 * The current global-shortcut bindings as display labels (e.g. "⌃⌘C"), for hints
 * shown around the UI. Reads from settings on mount and refreshes when the window
 * regains focus, so a rebind on the Shortcuts page is reflected. `null` until the
 * first read resolves.
 */
export function useShortcutLabels(): ShortcutLabels | null {
  const [labels, setLabels] = useState<ShortcutLabels | null>(null);

  useEffect(() => {
    const load = (): void => {
      void window.electronAPI.getSettings().then((settings) =>
        setLabels({
          startRecording: formatAccelerator(settings.shortcuts.startRecording),
          stopRecording: formatAccelerator(settings.shortcuts.stopRecording),
          bringToFront: formatAccelerator(settings.shortcuts.bringToFront),
        }),
      );
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  return labels;
}
