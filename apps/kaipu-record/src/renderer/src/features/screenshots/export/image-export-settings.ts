import { clampRasterScale } from "../annotations/compositor";
import type { BackgroundId } from "../beautify/backgrounds";

/**
 * The raster formats the Export popover writes (NIW2-852). PDF has its own button and its own
 * module; these three all come from one `canvas.toBlob`, so they share one settings shape.
 * No module here touches the DOM: the encoder (`image-encoder.ts`) does, and this file is
 * what decides what it is asked to do.
 */
export type ImageFormat = "png" | "jpeg" | "webp";

export const IMAGE_FORMATS: readonly ImageFormat[] = ["png", "jpeg", "webp"];

/** Output size relative to the export frame. */
export type ExportScale = 0.5 | 1 | 2;
export const EXPORT_SCALES: readonly ExportScale[] = [0.5, 1, 2];

/** `custom` is what the popover says once a field no longer matches a preset. */
export type PresetId = "original" | "web" | "small" | "custom";

export interface ImageExportSettings {
  format: ImageFormat;
  /** 0.1–1. Only JPEG and WebP read it; PNG is lossless. */
  quality: number;
  scale: ExportScale;
  /** Longest side in px the output never exceeds (only ever shrinks), or null for no cap. */
  maxSide: number | null;
}

export const QUALITY_MIN = 0.1;
export const QUALITY_MAX = 1;
export const QUALITY_STEP = 0.05;
export const DEFAULT_QUALITY = 0.9;

/**
 * Presets name a whole settings value. "Web" is what a page or a chat wants: WebP at 0.8, longest
 * side 1920 px. "Small" is the smallest thing everything opens: JPEG at 0.7, longest side 1280 px.
 * "Original" is what Save writes today.
 */
const PRESET_SETTINGS = {
  original: { format: "png", quality: DEFAULT_QUALITY, scale: 1, maxSide: null },
  web: { format: "webp", quality: 0.8, scale: 1, maxSide: 1920 },
  small: { format: "jpeg", quality: 0.7, scale: 1, maxSide: 1280 },
} as const satisfies Record<Exclude<PresetId, "custom">, ImageExportSettings>;

export const NAMED_PRESETS = ["original", "web", "small"] as const;
export type NamedPresetId = (typeof NAMED_PRESETS)[number];

/** The settings a preset stands for. */
export function settingsForPreset(preset: NamedPresetId): ImageExportSettings {
  return { ...PRESET_SETTINGS[preset] };
}

/** The settings a fresh install opens with: Original, which is what Save writes. */
export const DEFAULT_EXPORT_SETTINGS: ImageExportSettings = settingsForPreset("original");

/**
 * Which preset `settings` is. A PNG's quality is not read, so it does not count when comparing
 * (changing it must not turn "Original" into "Custom").
 */
export function presetOf(settings: ImageExportSettings): PresetId {
  for (const id of NAMED_PRESETS) {
    const p = PRESET_SETTINGS[id];
    if (
      p.format === settings.format &&
      p.scale === settings.scale &&
      p.maxSide === settings.maxSide &&
      (p.format === "png" || Math.abs(p.quality - settings.quality) < 1e-9)
    ) {
      return id;
    }
  }
  return "custom";
}

/**
 * Change one field. A real edit leaves the preset: the cap belongs to the preset, so it goes too
 * (a "Web" file the person then sets to JPEG is no longer "capped at 1920"). Choosing the value
 * already selected changes nothing, so the settings (preset and cap) come back untouched.
 */
export function withChange(
  settings: ImageExportSettings,
  change: Partial<Pick<ImageExportSettings, "format" | "quality" | "scale">>,
): ImageExportSettings {
  const same =
    (change.format === undefined || change.format === settings.format) &&
    (change.quality === undefined || change.quality === settings.quality) &&
    (change.scale === undefined || change.scale === settings.scale);
  if (same) return settings;
  return { ...settings, ...change, maxSide: null };
}

export function isLossy(format: ImageFormat): boolean {
  return format !== "png";
}

export function mimeTypeFor(format: ImageFormat): string {
  return `image/${format}`;
}

/** File extension without the dot. JPEG is `jpg`, what every file manager and tool expects. */
export function extensionFor(format: ImageFormat): "png" | "jpg" | "webp" {
  return format === "jpeg" ? "jpg" : format;
}

/**
 * JPEG has no alpha. A canvas encodes transparent pixels as black, so a JPEG is always painted
 * over white first; this says whether the person should be told that matters: only when the
 * export's background is "None", the one case that has transparent areas to flatten.
 */
export const FLATTEN_COLOR = "#ffffff";

export function flattensTransparency(format: ImageFormat, bg: BackgroundId): boolean {
  return format === "jpeg" && bg === "none";
}

/** Round to whole px, never below 1. */
function px(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * The output size for a frame of `w`×`h` px: the frame times `scale`, then shrunk to fit
 * `maxSide` if there is one. It only ever shrinks for the cap: a frame already inside it keeps
 * its size, and a cap never grows a 0.5× result back up. Pure, exported for tests.
 */
export function scaledSize(
  w: number,
  h: number,
  scale: number,
  maxSide: number | null,
): { width: number; height: number } {
  let factor = scale;
  const longest = Math.max(w, h, 1);
  if (maxSide !== null && longest * factor > maxSide) factor = maxSide / longest;
  return { width: px(w * factor), height: px(h * factor) };
}

/** What the exporter will do for one frame and one set of settings. */
export interface ExportPlan {
  /** The multiplier the composite is rasterized at (integer ≥ 1, clamped like the compositor does). */
  rasterScale: number;
  width: number;
  height: number;
  mimeType: string;
  extension: "png" | "jpg" | "webp";
  quality: number;
  /** Paint white under the image: JPEG only. */
  flatten: boolean;
}

/**
 * Plan an export of a frame of `frameW`×`frameH` px (the frame's 1× size, what the export box
 * shows). 2× is composited at 2× so annotations (vector) stay sharp; below 1× the 1× composite
 * is shrunk. If the compositor has to clamp the raster (very large frames), the output size is
 * clamped with it instead of upscaling a smaller bitmap. Pure, exported for tests.
 */
export function planExport(
  frameW: number,
  frameH: number,
  settings: ImageExportSettings,
): ExportPlan {
  const rasterScale = clampRasterScale(Math.ceil(settings.scale), frameW, frameH);
  const scale = Math.min(settings.scale, rasterScale);
  const { width, height } = scaledSize(frameW, frameH, scale, settings.maxSide);
  return {
    rasterScale,
    width,
    height,
    mimeType: mimeTypeFor(settings.format),
    extension: extensionFor(settings.format),
    quality: settings.quality,
    flatten: settings.format === "jpeg",
  };
}

/** A stable key for "the same plan": the estimate re-encodes only when it changes. */
export function settingsKey(settings: ImageExportSettings): string {
  return [
    settings.format,
    settings.quality.toFixed(2),
    settings.scale,
    settings.maxSide ?? "",
  ].join("|");
}

/**
 * Read stored settings back, field by field. Anything unreadable or out of range falls back to
 * the default for that field, so an old or hand-edited value never reaches the encoder.
 */
export function sanitizeSettings(raw: unknown): ImageExportSettings {
  const d = DEFAULT_EXPORT_SETTINGS;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const format = IMAGE_FORMATS.find((f) => f === r.format) ?? d.format;
  const scale = EXPORT_SCALES.find((s) => s === r.scale) ?? d.scale;
  const quality =
    typeof r.quality === "number" && Number.isFinite(r.quality)
      ? Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, r.quality))
      : d.quality;
  const maxSide =
    typeof r.maxSide === "number" && Number.isFinite(r.maxSide) && r.maxSide >= 1
      ? Math.round(r.maxSide)
      : null;
  return { format, quality, scale, maxSide };
}
