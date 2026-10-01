import { useEffect } from "react";
import type { WindowPresetName } from "@shared/window-size";

/**
 * Declare the window this screen wants.
 *
 * Applied on mount, never undone on unmount: the screen being navigated TO
 * declares its own, so the window follows wherever you are. An "undo on the way
 * out" is what left the window editor-sized after leaving the editor — the
 * minimum was released and the size was not.
 *
 * The trade-off worth knowing: resizing the window by hand is lost the next time
 * you change screens, because the destination restates its preset. Remembering a
 * per-screen manual size would fix that and is not built.
 */
export function useWindowPreset(preset: WindowPresetName): void {
  useEffect(() => {
    window.electronAPI.applyWindowPreset(preset);
  }, [preset]);
}
