import type { CaptureAction } from "@shared/types/screenshot-capture";
import type { ScreenshotCopyMode } from "@shared/types";

/**
 * What main does with a finished capture. Every capture is saved to the vault first;
 * the action only decides what comes after it.
 */
export interface AfterCapture {
  /** `editor` opens the saved shot in the image editor; `quiet` shows only the toast. */
  open: "editor" | "quiet";
  /** Whether main also puts the shot on the clipboard. */
  copy: boolean;
}

/**
 * Copy finishes quietly: the clipboard, the vault and the toast, without bringing the
 * app forward. Capture opens the editor on the saved shot, and copies it too when the
 * copy preference is automatic. Pure: no Electron imports.
 */
export function decideAfterCapture(action: CaptureAction, copy: ScreenshotCopyMode): AfterCapture {
  if (action === "copy") return { open: "quiet", copy: true };
  return { open: "editor", copy: copy === "auto" };
}
