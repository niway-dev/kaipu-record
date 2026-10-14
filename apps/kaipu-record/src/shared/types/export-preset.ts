/**
 * Export preset ids (NIW2-218), shared by main (settings + sidecar validation) and the
 * renderer/worker (`export-presets.ts`, which holds the numbers). Literals only: this module
 * is reachable from the preload bundle (see CLAUDE.md, "Package Import Rules").
 *
 * The order is the export sheet's: the recommended default first, Maximum quality last.
 */
export const EXPORT_PRESET_IDS = [
  "balanced",
  "youtube",
  "vertical",
  "square",
  "small-10",
  "small-25",
  "maximum",
] as const;
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export function isExportPresetId(value: unknown): value is ExportPresetId {
  return typeof value === "string" && (EXPORT_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * Ids older sidecars may still carry. "original" was the native-size `QUALITY_HIGH` export
 * before Balanced became the default; it is today's "maximum".
 */
export type LegacyExportPresetId = "original";

/** What a sidecar's `exportPreset` may hold: a current id, or a legacy one. */
export type StoredExportPresetId = ExportPresetId | LegacyExportPresetId;

/** A sidecar's `exportPreset` as a current id; null when absent or unknown. */
export function normalizeExportPresetId(value: unknown): ExportPresetId | null {
  if (value === "original") return "maximum";
  return isExportPresetId(value) ? value : null;
}

/** How the composed frame lands on a fixed canvas: whole frame + padding, or cover + crop. */
export const EXPORT_FRAMINGS = ["fit", "fill"] as const;
export type ExportFraming = (typeof EXPORT_FRAMINGS)[number];

export function isExportFraming(value: unknown): value is ExportFraming {
  return value === "fit" || value === "fill";
}

/**
 * Settings → Export quality: the row the export sheet preselects. Balanced for everyone by
 * default, including people who record at Maximum; another row in the sheet applies to that
 * export only.
 */
export const EXPORT_QUALITIES = ["balanced", "maximum"] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
export const DEFAULT_EXPORT_QUALITY: ExportQuality = "balanced";

/** A persisted (possibly untrusted) export quality, defaulted like `sanitizeQuality`. */
export function sanitizeExportQuality(value: unknown): ExportQuality {
  return value === "balanced" || value === "maximum" ? value : DEFAULT_EXPORT_QUALITY;
}
