/** Move / resize math for a privacy region's normalized rect, clamped to the frame. */
import { type NormRect, REDACTION } from "./redaction";

export type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function moveRect(orig: NormRect, dx: number, dy: number): NormRect {
  return {
    ...orig,
    x: clamp(orig.x + dx, 0, 1 - orig.w),
    y: clamp(orig.y + dy, 0, 1 - orig.h),
  };
}

/** Drag `corner` to `to`; the opposite corner stays fixed; never smaller than REDACTION.minSize. */
export function resizeRect(orig: NormRect, corner: Corner, to: { x: number; y: number }): NormRect {
  const min = REDACTION.minSize;
  const left = orig.x;
  const top = orig.y;
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;
  const px = clamp(to.x, 0, 1);
  const py = clamp(to.y, 0, 1);
  const x0 = corner === "nw" || corner === "sw" ? Math.min(px, right - min) : left;
  const x1 = corner === "ne" || corner === "se" ? Math.max(px, left + min) : right;
  const y0 = corner === "nw" || corner === "ne" ? Math.min(py, bottom - min) : top;
  const y1 = corner === "sw" || corner === "se" ? Math.max(py, top + min) : bottom;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
