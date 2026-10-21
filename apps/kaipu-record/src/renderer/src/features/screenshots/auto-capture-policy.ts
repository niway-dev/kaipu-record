import type { ScreenshotCopyMode } from "@shared/types";
import type { ImageSource } from "./image-source";

/**
 * What a screenshot editor does on its own the moment it opens. Only an in-memory
 * capture has any; a shot re-opened from the Library and an image pasted from the
 * clipboard have none.
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
 * An in-memory capture exists only because main could not write it to the vault: the
 * editor tries again the moment it can export, since every capture belongs in the
 * Library. A shot re-opened from the Library already has a row and must never get a
 * second one on open; a pasted image is the user's own, saved only when they ask.
 */
export function shouldAutoSaveOnOpen(openKind: OpenKind): boolean {
  return openKind === "capture";
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

/** What the editor does on its own when it opens, as one value. */
export function autoActionsOnOpen(copyMode: ScreenshotCopyMode, openKind: OpenKind): AutoActions {
  return {
    save: shouldAutoSaveOnOpen(openKind),
    copy: shouldAutoCopyOnOpen(copyMode, openKind),
  };
}
