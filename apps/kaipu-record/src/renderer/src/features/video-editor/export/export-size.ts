/**
 * How the export flow talks about size (NIW2-218 export redesign): in MB, against the
 * original, never in bitrates. Every number comes from `resolveExportTarget`; these helpers
 * only decide how to say it.
 */
import { type ExportPresetId, PRESETS } from "./export-presets";

/** GitHub · Jira · Linear accept up to this; above it a recording needs a lighter copy to attach. */
export const SHARE_LIMIT_BYTES = PRESETS["small-10"].capBytes!;

/** Above the chat cap a file is heavy to send anywhere: amber size, "heavy to send" banner. */
export const HEAVY_TO_SEND_BYTES = PRESETS["small-25"].capBytes!;

/** Decimal megabytes, as the caps are counted (GitHub/Discord). */
export function formatMB(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function isHeavyToSend(bytes: number): boolean {
  return bytes > HEAVY_TO_SEND_BYTES;
}

/**
 * How sure the estimate is:
 * - "about": a capped row (the encoder aims at the cap) or Balanced;
 * - "up-to": a fixed canvas (YouTube, Vertical, Square), whose bitrate is a ceiling that
 *   screen content rarely reaches;
 * - "full": Maximum quality, which has no estimate (QUALITY_HIGH).
 */
export type SizeKind = "about" | "up-to" | "full";

export function sizeKindOf(presetId: ExportPresetId): SizeKind {
  if (presetId === "maximum") return "full";
  return PRESETS[presetId].canvas !== null ? "up-to" : "about";
}

/**
 * Whole percent saved against the original: `1 − result / original`, or null when there is
 * nothing to compare (no original size, no estimate) or the copy is not lighter.
 */
export function percentLighter(
  resultBytes: number | null,
  originalBytes: number | null | undefined,
): number | null {
  if (resultBytes === null || !originalBytes || originalBytes <= 0) return null;
  if (resultBytes >= originalBytes) return null;
  return Math.round((1 - resultBytes / originalBytes) * 100);
}

/** True when the source's aspect is not 16:9, so a 16:9 canvas adds bars. */
export function addsBarsAt169(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height - 16 / 9) > 0.01;
}
