/**
 * Privacy regions (blur / cover). Geometry is normalized 0–1 of the ORIGINAL frame;
 * times are SOURCE seconds. Every size that depends on resolution is expressed as a
 * fraction of the frame height, so the preview (CSS px of the displayed video) and
 * the export (native px) compute the same visual strength — see `blurSigmaPx`.
 */

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RedactionBase {
  id: string;
  start: number;
  end: number;
  rect: NormRect;
}

export interface BlurRedaction extends RedactionBase {
  kind: "blur";
  /** REDACTION.minIntensity–100. */
  intensity: number;
  style: "gaussian" | "pixelate";
}

export interface CoverRedaction extends RedactionBase {
  kind: "cover";
  /** One of REDACTION.coverFills. */
  fill: string;
  /** Optional centered text; "" = plain block. */
  label: string;
}

export type Redaction = BlurRedaction | CoverRedaction;

export const REDACTION = {
  /** A soft gaussian over text can be partially reversed — never allow less. */
  minIntensity: 40,
  defaultIntensity: 70,
  defaultSeconds: 5,
  minSeconds: 1,
  /** Smallest drawable region, normalized (avoids invisible slivers). */
  minSize: 0.01,
  coverFills: ["#18181b", "#F6055C", "#3d5570", "#f3f3f5"],
  /** Reference preview height the UI spec's `2 + intensity/100 × 9 px` was tuned on. */
  specPreviewHeight: 382,
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function clampIntensity(intensity: number): number {
  return clamp(Math.round(intensity), REDACTION.minIntensity, 100);
}

/** Gaussian standard deviation in px for a frame `frameHeightPx` tall. */
export function blurSigmaPx(intensity: number, frameHeightPx: number): number {
  const specPx = 2 + (clampIntensity(intensity) / 100) * 9;
  return (specPx / REDACTION.specPreviewHeight) * frameHeightPx;
}

/** Mosaic cell size in px (≥ 4) for a frame `frameHeightPx` tall. */
export function pixelBlockPx(intensity: number, frameHeightPx: number): number {
  const k = (clampIntensity(intensity) - REDACTION.minIntensity) / (100 - REDACTION.minIntensity);
  return Math.max(4, Math.round((0.012 + (0.04 - 0.012) * k) * frameHeightPx));
}

/** Cover label size: the spec's 10.5 px at the 382 px reference preview height. */
export function coverLabelPx(frameHeightPx: number): number {
  return (10.5 / REDACTION.specPreviewHeight) * frameHeightPx;
}

/** Readable label color on a cover fill: dark text on the light swatch, white elsewhere. */
export function coverLabelColor(fill: string): string {
  return fill.toLowerCase() === "#f3f3f5" ? "#18181b" : "#ffffff";
}

/**
 * Integer pixel rect for a normalized rect, rounded OUTWARD (floor the near edge, ceil
 * the far edge) so a redaction never leaves a 1 px unredacted seam, clipped to the frame.
 */
export function rectToPx(
  rect: NormRect,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  // EPS absorbs float noise (0.301 × 1000 = 301.00000000000006) so an exact edge
  // doesn't grow by a spurious pixel; any real fraction still rounds outward.
  const EPS = 1e-6;
  const x0 = clamp(Math.floor(rect.x * width + EPS), 0, width);
  const y0 = clamp(Math.floor(rect.y * height + EPS), 0, height);
  const x1 = clamp(Math.ceil((rect.x + rect.w) * width - EPS), 0, width);
  const y1 = clamp(Math.ceil((rect.y + rect.h) * height - EPS), 0, height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Redactions to apply to a frame that is on screen during source [frameStart, frameEnd).
 * Interval OVERLAP, not a point test on the frame timestamp: a frame that is visible for
 * any part of a redaction's window gets redacted, so no frame at either edge leaks.
 */
export function redactionsForFrame(
  redactions: Redaction[],
  frameStart: number,
  frameEnd: number,
): Redaction[] {
  return redactions.filter((r) => r.start < frameEnd && r.end > frameStart);
}

/** Normalize a drag from (ax, ay) to (bx, by) into a rect clamped to the frame. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number): NormRect {
  const x0 = clamp(Math.min(ax, bx), 0, 1);
  const y0 = clamp(Math.min(ay, by), 0, 1);
  const x1 = clamp(Math.max(ax, bx), 0, 1);
  const y1 = clamp(Math.max(ay, by), 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
