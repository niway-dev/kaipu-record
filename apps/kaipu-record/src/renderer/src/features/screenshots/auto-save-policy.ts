import type { ScreenshotSaveMode } from "@shared/types";

/**
 * Auto mode writes a FRESH capture to the vault as soon as the editor can export it.
 * A screenshot re-opened from the Library already has a row (`source.kind === "local"`)
 * and must never get a second one on open.
 */
export function shouldAutoSaveOnOpen(mode: ScreenshotSaveMode, sourceKind: string): boolean {
  return mode === "auto" && sourceKind !== "local";
}
