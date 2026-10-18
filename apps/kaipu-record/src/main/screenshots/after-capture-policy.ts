import type { CaptureAction } from "@shared/types/screenshot-capture";
import type { ScreenshotCopyMode, ScreenshotSaveMode } from "@shared/types";

/** What main does with a finished capture: open the editor, or finish it quietly. */
export type AfterCapture = { open: "editor" } | { open: "quiet"; save: boolean; copy: boolean };

/**
 * The overlay's action decides first, then the preferences. Copy always finishes
 * quietly (the clipboard, plus the vault only when saving is automatic). Capture
 * opens the editor unless saving is automatic, in which case nobody has anything
 * left to decide. Pure: no Electron imports.
 */
export function decideAfterCapture(
  action: CaptureAction,
  save: ScreenshotSaveMode,
  copy: ScreenshotCopyMode,
): AfterCapture {
  if (action === "copy") return { open: "quiet", save: save === "auto", copy: true };
  if (save === "manual") return { open: "editor" };
  return { open: "quiet", save: true, copy: copy === "auto" };
}
