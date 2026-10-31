/**
 * Export preset ids (NIW2-218), shared by main (settings + sidecar validation) and the
 * renderer/worker (`export-presets.ts`, which holds the numbers). Literals only: this module
 * is reachable from the preload bundle (see CLAUDE.md, "Package Import Rules").
 *
 * The order is the export sheet's: the recommended default first, Maximum quality last.
 */
export const EXPORT_PRESET_IDS = [
  "balanced",
  "light",
  "youtube-1440",
  "youtube-4k",
  "vertical",
  "square",
  "maximum",
] as const;
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export function isExportPresetId(value: unknown): value is ExportPresetId {
  return typeof value === "string" && (EXPORT_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * YouTube's two canvases (NIW2-564): 2560×1440 and 3840×2160. YouTube gives 1440p and 4K
 * uploads a better codec and far more bitrate than 1080p ones, so even a 1080p-class screen
 * recording, upscaled, looks sharper there than the same recording uploaded at 1080p.
 */
export const YOUTUBE_PRESET_IDS = ["youtube-1440", "youtube-4k"] as const;
export type YoutubePresetId = (typeof YOUTUBE_PRESET_IDS)[number];

export function isYoutubePreset(id: unknown): id is YoutubePresetId {
  return typeof id === "string" && (YOUTUBE_PRESET_IDS as readonly string[]).includes(id);
}

/**
 * Ids older sidecars may still carry. "original" was the native-size `QUALITY_HIGH` export
 * before Balanced became the default; it is today's "maximum". "small-10" / "small-25" were
 * the size-capped rows the quality tiers replaced; they read as "light", the tier that took
 * their place. "youtube" was the fixed 1920×1080 YouTube export before the 1440p and 4K
 * canvases replaced it (NIW2-564); it reads as "youtube-1440", the row for the same
 * destination. ("Already exported" still never reuses any of them: see `ENCODE_REVISION`.)
 */
export type LegacyExportPresetId = "original" | "small-10" | "small-25" | "youtube";

/** What a sidecar's `exportPreset` may hold: a current id, or a legacy one. */
export type StoredExportPresetId = ExportPresetId | LegacyExportPresetId;

/** A sidecar's `exportPreset` as a current id; null when absent or unknown. */
export function normalizeExportPresetId(value: unknown): ExportPresetId | null {
  if (value === "original") return "maximum";
  if (value === "small-10" || value === "small-25") return "light";
  if (value === "youtube") return "youtube-1440";
  return isExportPresetId(value) ? value : null;
}

/**
 * Where a copy is going (the Export screen's destinations), as stored in an export's sidecar
 * (`exportDestination`). Literals, like the preset ids; the renderer's `DESTINATION_IDS` must
 * name the same ones, which `destinations.test.ts` pins. Stored because one preset serves two
 * destinations (chat's and email's Balanced), so the preset alone cannot say which it was.
 */
export const EXPORT_DESTINATION_IDS = [
  "youtube",
  "vertical",
  "square",
  "github",
  "chat",
  "email",
  "archive",
] as const;
export type ExportDestinationId = (typeof EXPORT_DESTINATION_IDS)[number];

export function isExportDestinationId(value: unknown): value is ExportDestinationId {
  return typeof value === "string" && (EXPORT_DESTINATION_IDS as readonly string[]).includes(value);
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
