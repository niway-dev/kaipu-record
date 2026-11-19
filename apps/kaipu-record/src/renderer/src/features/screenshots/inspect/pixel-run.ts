/**
 * The ruler behind Inspect mode (NIW2-702): a pixel run is the stretch of pixels around the
 * cursor whose color stays within a tolerance of the STARTING pixel. Pure, so the view only
 * draws what this returns and NIW2-708 can restyle it without touching the scan.
 *
 * Comparing every pixel with the start, not with its neighbor, keeps a gradient from being
 * walked end to end (spec, section 3). The difference is the per-channel maximum, alpha
 * included, in 0–255 sRGB units.
 */
import type { PixelBuffer, PixelWindow } from "./pixel-buffer";

export type RulerAxis = "x" | "y";

/**
 * A run in image pixels. `from` and `to` are pixel EDGES along `axis`: the run covers pixels
 * `from` … `to - 1`, so its length is `to - from`. `at` is the pixel row (axis x) or column
 * (axis y) it was measured on.
 */
export interface PixelRun {
  axis: RulerAxis;
  from: number;
  to: number;
  at: number;
}

/** Tolerance the ruler starts with: absorbs PNG noise and subpixel text fringes, not borders. */
export const DEFAULT_TOLERANCE = 10;
export const MIN_TOLERANCE = 0;
export const MAX_TOLERANCE = 255;

export function clampTolerance(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOLERANCE;
  return Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, Math.round(value)));
}

export function runLength(run: Pick<PixelRun, "from" | "to">): number {
  return run.to - run.from;
}

/** Offset of pixel (x, y) in the RGBA array. */
function offset(buf: PixelBuffer, x: number, y: number): number {
  return (y * buf.width + x) * 4;
}

/** True when pixel `i` is within `tolerance` of pixel `seed`, per channel, alpha included. */
function within(data: Uint8ClampedArray, seed: number, i: number, tolerance: number): boolean {
  return (
    Math.abs(data[i] - data[seed]) <= tolerance &&
    Math.abs(data[i + 1] - data[seed + 1]) <= tolerance &&
    Math.abs(data[i + 2] - data[seed + 2]) <= tolerance &&
    Math.abs(data[i + 3] - data[seed + 3]) <= tolerance
  );
}

/**
 * From the pixel at position `start` on the line, walk in `dir` (-1 or +1) while each pixel is
 * within the tolerance of `start`, never leaving `[lo, hi)`. Returns the last position still
 * inside the run.
 */
function walk(
  buf: PixelBuffer,
  axis: RulerAxis,
  at: number,
  start: number,
  dir: -1 | 1,
  tolerance: number,
  lo: number,
  hi: number,
): number {
  const pos = (p: number): number => (axis === "x" ? offset(buf, p, at) : offset(buf, at, p));
  const seed = pos(start);
  let last = start;
  for (let p = start + dir; p >= lo && p < hi; p += dir) {
    if (!within(buf.data, seed, pos(p), tolerance)) break;
    last = p;
  }
  return last;
}

/**
 * The run through pixel (x, y) along `axis`. null when (x, y) is not a pixel of the image,
 * which is how a pointer over padding or empty canvas reports no measurement at all.
 *
 * `win` is the part of the image that shows (a cropped base): the run starts inside it, never
 * leaves it, and `outer` finds nothing beyond its edge, as at the image's own edge. Without it
 * the whole image counts.
 *
 * `outer`: the outer size (the `Shift` modifier). From each edge of the run, the next pixel
 * outward seeds a second scan, and the result reaches the far end of those neighboring runs:
 * inside a button with a 1 px border, the inner run is the fill and the outer one includes
 * the border. At the image's edge there is nothing beyond, so that side stays where it is.
 */
export function scanRun(
  buf: PixelBuffer,
  x: number,
  y: number,
  axis: RulerAxis,
  tolerance: number,
  outer = false,
  win?: PixelWindow,
): PixelRun | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return null;
  const bounds = win ?? { x0: 0, y0: 0, x1: buf.width, y1: buf.height };
  if (x < bounds.x0 || y < bounds.y0 || x >= bounds.x1 || y >= bounds.y1) return null;
  const tol = clampTolerance(tolerance);
  const at = axis === "x" ? y : x;
  const start = axis === "x" ? x : y;
  const min = axis === "x" ? bounds.x0 : bounds.y0;
  const max = axis === "x" ? bounds.x1 : bounds.y1;
  let lo = walk(buf, axis, at, start, -1, tol, min, max);
  let hi = walk(buf, axis, at, start, 1, tol, min, max);
  if (outer) {
    if (lo > min) lo = walk(buf, axis, at, lo - 1, -1, tol, min, max);
    if (hi < max - 1) hi = walk(buf, axis, at, hi + 1, 1, tol, min, max);
  }
  return { axis, from: lo, to: hi + 1, at };
}

/** Wheel distance, in CSS pixels, that changes the tolerance by one step. */
export const WHEEL_PX_PER_STEP = 25;

/**
 * Turn a wheel event into tolerance steps. A trackpad sends many small deltas, a mouse wheel a
 * few large ones, so deltas accumulate in `rest` and a step is taken per `WHEEL_PX_PER_STEP`.
 * A line- or page-mode event (`deltaMode` 1, 2) is one wheel notch and takes one step, whatever
 * its line count (a notch is often 3 lines): one notch, one unit of tolerance. Scrolling up (negative
 * delta) raises the tolerance. `Shift` turns a vertical wheel into a horizontal one on macOS,
 * so the larger of the two deltas is used.
 */
export function wheelSteps(
  rest: number,
  e: { deltaX: number; deltaY: number; deltaMode: number },
): { steps: number; rest: number } {
  const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (!Number.isFinite(delta) || delta === 0) return { steps: 0, rest };
  if (e.deltaMode !== 0) return { steps: -Math.sign(delta), rest: 0 };
  const total = rest - delta;
  const steps = Math.trunc(total / WHEEL_PX_PER_STEP);
  return { steps, rest: total - steps * WHEEL_PX_PER_STEP };
}
