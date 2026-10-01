import { useEffect } from "react";
import type { WindowPresetName } from "@shared/window-size";

/**
 * Apply the window preset for the current screen.
 *
 * Called with a value derived from the route, so it re-applies on every
 * navigation rather than once per mount. Nothing is undone on unmount: the
 * destination states its own, which is what makes leaving an editor shrink the
 * window instead of stranding it.
 *
 * Main ignores a repeat, so navigating between two base screens costs nothing.
 *
 * The trade-off worth knowing: resizing by hand is lost when the preset
 * changes, because entering an editor and leaving it restates both. Remembering
 * a per-screen manual size would fix that and is not built.
 */
export function useWindowPreset(preset: WindowPresetName): void {
  useEffect(() => {
    window.electronAPI.applyWindowPreset(preset);
  }, [preset]);
}
