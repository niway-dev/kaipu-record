/**
 * How the export flow talks about size (NIW2-218 export redesign): in MB, against the
 * original, never in bitrates. Every number comes from `resolveExportTarget`; these helpers
 * only decide how to say it.
 */
import { type ExportPresetId, MB, PRESETS } from "./export-presets";

/**
 * Above this, right after recording, the "Recording saved" card offers a light copy (owner
 * decision: a file over 10 MB is worth slimming before sending, whatever GitHub's limit).
 */
export const SHARE_LIMIT_BYTES = 10 * MB;

/**
 * Above this a file is heavy to send anywhere — chat apps included: amber size and the
 * "heavy to send" banner on its page.
 */
export const HEAVY_TO_SEND_BYTES = 25 * MB;

/** Decimal megabytes, as GitHub counts them and Finder shows them. */
export function formatMB(bytes: number): string {
  const mb = bytes / MB;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function isHeavyToSend(bytes: number): boolean {
  return bytes > HEAVY_TO_SEND_BYTES;
}

/**
 * How sure the estimate is:
 * - "about": a quality tier (Balanced, Light), where the encoder lands on its bitrate;
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

/**
 * Seconds left, from the rate so far: `elapsed × (1 − f) / f`. Null until there is enough
 * to go on (a few percent and a couple of seconds), so the first guess isn't wild. Rounded
 * so it doesn't flicker: 5 s steps under a minute, whole minutes above.
 */
export function exportEtaSeconds(fraction: number, elapsedMs: number): number | null {
  if (fraction < 0.03 || fraction >= 1 || elapsedMs < 2000) return null;
  const left = (elapsedMs * (1 - fraction)) / fraction / 1000;
  if (left < 60) return Math.max(5, Math.ceil(left / 5) * 5);
  return Math.round(left / 60) * 60;
}
