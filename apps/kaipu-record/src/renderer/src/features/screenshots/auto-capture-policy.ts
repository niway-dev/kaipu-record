import type { ScreenshotCopyMode, ScreenshotSaveMode } from "@shared/types";

/**
 * What a screenshot editor does on its own the moment it opens. The two
 * preferences are independent, so a fresh capture has four outcomes; a shot
 * re-opened from the Library (`source.kind === "local"`) has none.
 */
export interface AutoActions {
  /** Write the capture to the vault. */
  save: boolean;
  /** Put the composited PNG on the system clipboard. */
  copy: boolean;
}

/**
 * Auto mode writes a FRESH capture to the vault as soon as the editor can export it.
 * A screenshot re-opened from the Library already has a row (`source.kind === "local"`)
 * and must never get a second one on open.
 */
export function shouldAutoSaveOnOpen(mode: ScreenshotSaveMode, sourceKind: string): boolean {
  return mode === "auto" && sourceKind !== "local";
}

/**
 * Auto mode puts a FRESH capture on the clipboard as soon as the editor can export it,
 * so the capture shortcut alone is enough to paste elsewhere. Re-opening a saved shot
 * is browsing, not capturing — it must not overwrite whatever the user already copied.
 */
export function shouldAutoCopyOnOpen(mode: ScreenshotCopyMode, sourceKind: string): boolean {
  return mode === "auto" && sourceKind !== "local";
}

/** The truth table both preferences form, as one value the editor acts on. */
export function autoActionsOnOpen(
  saveMode: ScreenshotSaveMode,
  copyMode: ScreenshotCopyMode,
  sourceKind: string,
): AutoActions {
  return {
    save: shouldAutoSaveOnOpen(saveMode, sourceKind),
    copy: shouldAutoCopyOnOpen(copyMode, sourceKind),
  };
}
