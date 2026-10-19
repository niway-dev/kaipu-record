import type { ScreenshotCopyMode, ScreenshotSaveMode } from "@shared/types";
import type { ImageSource } from "./image-source";

/**
 * What a screenshot editor does on its own the moment it opens. The two
 * preferences are independent, so a fresh capture has four outcomes; a shot
 * re-opened from the Library and an image pasted from the clipboard have none.
 */
export interface AutoActions {
  /** Write the capture to the vault. */
  save: boolean;
  /** Put the composited PNG on the system clipboard. */
  copy: boolean;
}

/**
 * How the editor was opened, as far as the auto actions care: `capture` is a
 * fresh screenshot, `local` a shot re-opened from the Library, `paste` an image
 * the user brought in from the clipboard. Only a capture is new to Kaipu.
 */
export type OpenKind = "capture" | "local" | "paste";
// A quiet capture (bytes kept by main for Annotate) counts as `local`: main already
// saved and/or copied it, so the editor must not do either again.

export function openKindOf(source: ImageSource): OpenKind {
  if (source.kind === "local") return "local";
  if (source.kind === "blob" && source.origin === "paste") return "paste";
  if (source.kind === "blob" && source.origin === "quiet") return "local";
  return "capture";
}

/**
 * Auto mode writes a FRESH capture to the vault as soon as the editor can export it.
 * A screenshot re-opened from the Library already has a row and must never get a
 * second one on open; a pasted image is the user's own, saved only when they ask.
 */
export function shouldAutoSaveOnOpen(mode: ScreenshotSaveMode, openKind: OpenKind): boolean {
  return mode === "auto" && openKind === "capture";
}

/**
 * Auto mode puts a FRESH capture on the clipboard as soon as the editor can export it,
 * so the capture shortcut alone is enough to paste elsewhere. Re-opening a saved shot
 * is browsing, not capturing — it must not overwrite whatever the user already copied.
 * A pasted image came FROM the clipboard: copying it back would only replace the
 * user's original with a re-encoded copy.
 */
export function shouldAutoCopyOnOpen(mode: ScreenshotCopyMode, openKind: OpenKind): boolean {
  return mode === "auto" && openKind === "capture";
}

/** The truth table both preferences form, as one value the editor acts on. */
export function autoActionsOnOpen(
  saveMode: ScreenshotSaveMode,
  copyMode: ScreenshotCopyMode,
  openKind: OpenKind,
): AutoActions {
  return {
    save: shouldAutoSaveOnOpen(saveMode, openKind),
    copy: shouldAutoCopyOnOpen(copyMode, openKind),
  };
}
