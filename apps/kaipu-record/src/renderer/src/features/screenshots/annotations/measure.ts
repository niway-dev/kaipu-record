/**
 * Geometry of a pinned `measure` annotation (NIW2-702), shared by the live layer, the handles
 * and the export compositor so all three draw the same line. Pure.
 */
import type { MeasureAnnotation } from "./scene";

export interface NormPt {
  x: number;
  y: number;
}

export function measureLength(a: Pick<MeasureAnnotation, "from" | "to">): number {
  return a.to - a.from;
}

/** The label the line carries: the length in image pixels, never scaled by zoom. */
export function measureLabel(a: Pick<MeasureAnnotation, "from" | "to">): string {
  return `${measureLength(a)} px`;
}

/**
 * The two ends of the line in the layer's normalized (0–1 of the image) space. The line runs
 * through the middle of the measured row or column, from the first pixel's outer edge to the
 * last pixel's outer edge.
 */
export function measureEndpoints(a: MeasureAnnotation): { p1: NormPt; p2: NormPt } {
  if (a.axis === "x") {
    const y = (a.at + 0.5) / a.imageH;
    return { p1: { x: a.from / a.imageW, y }, p2: { x: a.to / a.imageW, y } };
  }
  const x = (a.at + 0.5) / a.imageW;
  return { p1: { x, y: a.from / a.imageH }, p2: { x, y: a.to / a.imageH } };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Drag one end to a normalized point. The end moves only along the axis, snaps to a pixel
 * edge, stays inside the image and never crosses the other end (a measurement is at least
 * one pixel long).
 */
export function dragMeasureEnd(
  a: MeasureAnnotation,
  end: "from" | "to",
  p: NormPt,
): Pick<MeasureAnnotation, "from" | "to"> {
  const size = a.axis === "x" ? a.imageW : a.imageH;
  const edge = Math.round((a.axis === "x" ? p.x : p.y) * size);
  if (end === "from") return { from: clamp(edge, 0, a.to - 1), to: a.to };
  return { from: a.from, to: clamp(edge, a.from + 1, size) };
}

/**
 * Move the whole measurement by a normalized delta, snapped to whole pixels and kept inside
 * the image. The length never changes.
 */
export function moveMeasure(
  a: MeasureAnnotation,
  dx: number,
  dy: number,
): Pick<MeasureAnnotation, "from" | "to" | "at"> {
  const along = a.axis === "x" ? a.imageW : a.imageH;
  const across = a.axis === "x" ? a.imageH : a.imageW;
  const dAlong = Math.round((a.axis === "x" ? dx : dy) * along);
  const dAcross = Math.round((a.axis === "x" ? dy : dx) * across);
  const shift = clamp(dAlong, -a.from, along - a.to);
  return {
    from: a.from + shift,
    to: a.to + shift,
    at: clamp(a.at + dAcross, 0, across - 1),
  };
}
