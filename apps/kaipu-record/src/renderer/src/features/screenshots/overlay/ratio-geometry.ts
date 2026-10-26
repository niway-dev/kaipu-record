import { MIN_AREA_SIZE } from "@shared/capture-geometry";
import type { CaptureRect, RecordingRatio } from "@shared/types/screenshot-capture";
import type { HandleId, Pt } from "../annotations/handles";

/**
 * Aspect-ratio geometry for the Frame box when the overlay opens to record. Every rectangle
 * is window-local DIP (display-relative, because the overlay covers the display) and stays
 * inside `area`, the work area. Results are whole DIP, so a locked ratio is exact up to one
 * DIP of rounding; the engine rounds the encoded size to even pixels anyway (ADR 0030).
 */

/** Width over height for a locked ratio; `null` for Free. */
export function ratioValue(ratio: RecordingRatio): number | null {
  switch (ratio) {
    case "16:9":
      return 16 / 9;
    case "9:16":
      return 9 / 16;
    case "1:1":
      return 1;
    default:
      return null;
  }
}

/** The smallest width and height a box with `ratio` may have: both sides at least `min`. */
function minimumSize(ratio: number, min: number): { width: number; height: number } {
  return ratio >= 1 ? { width: min * ratio, height: min } : { width: min, height: min / ratio };
}

/** Scale `width × height` (already at `ratio`) down until it fits `maxW × maxH`. */
function fitInside(
  width: number,
  height: number,
  ratio: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  let w = width;
  let h = height;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { width: w, height: h };
}

/** Grow `width × height` (at `ratio`) until both sides reach the minimum. */
function atLeastMinimum(
  width: number,
  height: number,
  ratio: number,
  min: number,
): { width: number; height: number } {
  const floor = minimumSize(ratio, min);
  return width < floor.width ? floor : { width, height };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Round to whole DIP and keep the box inside `area` (moving it, never shrinking it). */
function placeInside(
  x: number,
  y: number,
  width: number,
  height: number,
  area: CaptureRect,
): CaptureRect {
  const w = Math.min(Math.round(width), area.width);
  const h = Math.min(Math.round(height), area.height);
  return {
    x: clamp(Math.round(x), area.x, area.x + area.width - w),
    y: clamp(Math.round(y), area.y, area.y + area.height - h),
    width: w,
    height: h,
  };
}

/**
 * Apply `ratio` to an existing box (the user picked a ratio chip, or the remembered area was
 * drawn with one): same width where it fits, same centre, inside `area`. Free returns the box
 * unchanged.
 */
export function fitRatio(
  rect: CaptureRect,
  ratio: RecordingRatio,
  area: CaptureRect,
  min: number = MIN_AREA_SIZE,
): CaptureRect {
  const r = ratioValue(ratio);
  if (r === null) return rect;
  const wanted = atLeastMinimum(rect.width, rect.width / r, r, min);
  const { width, height } = fitInside(wanted.width, wanted.height, r, area.width, area.height);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return placeInside(cx - width / 2, cy - height / 2, width, height, area);
}

/**
 * A box at `ratio` spanned from a fixed `anchor` corner toward `pointer`: the side the
 * pointer pulls further decides the size, the room between the anchor and the work area's
 * edge caps it. Used for drawing a new box and for dragging a corner handle.
 */
export function spanWithRatio(
  anchor: Pt,
  pointer: Pt,
  ratio: number,
  area: CaptureRect,
  min: number = MIN_AREA_SIZE,
): CaptureRect {
  const right = pointer.x >= anchor.x;
  const down = pointer.y >= anchor.y;
  const dx = Math.abs(pointer.x - anchor.x);
  const dy = Math.abs(pointer.y - anchor.y);
  const pulled =
    dx >= dy * ratio ? { width: dx, height: dx / ratio } : { width: dy * ratio, height: dy };
  const wanted = atLeastMinimum(pulled.width, pulled.height, ratio, min);
  const maxW = right ? area.x + area.width - anchor.x : anchor.x - area.x;
  const maxH = down ? area.y + area.height - anchor.y : anchor.y - area.y;
  const { width, height } = fitInside(wanted.width, wanted.height, ratio, maxW, maxH);
  return placeInside(
    right ? anchor.x : anchor.x - width,
    down ? anchor.y : anchor.y - height,
    width,
    height,
    area,
  );
}

const OPPOSITE_CORNER: Partial<Record<HandleId, (r: CaptureRect) => Pt>> = {
  nw: (r) => ({ x: r.x + r.width, y: r.y + r.height }),
  ne: (r) => ({ x: r.x, y: r.y + r.height }),
  se: (r) => ({ x: r.x, y: r.y }),
  sw: (r) => ({ x: r.x + r.width, y: r.y }),
};

/**
 * Resize `start` by dragging `handle` to `pointer` with the ratio locked. A corner keeps the
 * opposite corner still; an edge keeps the opposite edge still and grows the other side
 * around the box's centre line. Free is not handled here: the overlay's own resize runs.
 */
export function resizeWithRatio(
  start: CaptureRect,
  handle: HandleId,
  pointer: Pt,
  ratio: number,
  area: CaptureRect,
  min: number = MIN_AREA_SIZE,
): CaptureRect {
  const corner = OPPOSITE_CORNER[handle];
  if (corner) return spanWithRatio(corner(start), pointer, ratio, area, min);
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  if (handle === "e" || handle === "w") {
    const fixed = handle === "e" ? start.x : start.x + start.width;
    const maxW = handle === "e" ? area.x + area.width - fixed : fixed - area.x;
    const raw = Math.max(handle === "e" ? pointer.x - fixed : fixed - pointer.x, 0);
    const wanted = atLeastMinimum(raw, raw / ratio, ratio, min);
    const { width, height } = fitInside(wanted.width, wanted.height, ratio, maxW, area.height);
    return placeInside(
      handle === "e" ? fixed : fixed - width,
      cy - height / 2,
      width,
      height,
      area,
    );
  }
  if (handle === "n" || handle === "s") {
    const fixed = handle === "s" ? start.y : start.y + start.height;
    const maxH = handle === "s" ? area.y + area.height - fixed : fixed - area.y;
    const raw = Math.max(handle === "s" ? pointer.y - fixed : fixed - pointer.y, 0);
    const wanted = atLeastMinimum(raw * ratio, raw, ratio, min);
    const { width, height } = fitInside(wanted.width, wanted.height, ratio, area.width, maxH);
    return placeInside(
      cx - width / 2,
      handle === "s" ? fixed : fixed - height,
      width,
      height,
      area,
    );
  }
  return start;
}

/** The size readout above the box: DIP times the display's scale factor, whole pixels. */
export function devicePixelSize(
  rect: Pick<CaptureRect, "width" | "height">,
  scaleFactor: number,
): { width: number; height: number } {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return { width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) };
}
