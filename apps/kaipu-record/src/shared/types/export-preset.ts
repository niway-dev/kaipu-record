/**
 * Export preset ids (NIW2-218), shared by main (settings + sidecar validation) and the
 * renderer/worker (`export-presets.ts`, which holds the numbers). Literals only: this module
 * is reachable from the preload bundle (see CLAUDE.md, "Package Import Rules").
 */
export const EXPORT_PRESET_IDS = [
  "original",
  "youtube",
  "vertical",
  "square",
  "small-10",
  "small-25",
] as const;
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export function isExportPresetId(value: unknown): value is ExportPresetId {
  return typeof value === "string" && (EXPORT_PRESET_IDS as readonly string[]).includes(value);
}

/** How the composed frame lands on a fixed canvas: whole frame + padding, or cover + crop. */
export const EXPORT_FRAMINGS = ["fit", "fill"] as const;
export type ExportFraming = (typeof EXPORT_FRAMINGS)[number];

export function isExportFraming(value: unknown): value is ExportFraming {
  return value === "fit" || value === "fill";
}
