/**
 * Geometry of a pinned `measure` annotation (NIW2-702), shared by the live layer, the handles
 * and the export compositor so all three draw the same line. Pure.
 */
import { baseFullRect, type BasePlacement, type MeasureAnnotation } from "./scene";
import { stepInk } from "./tools";
import { RULER_HALO_PX, RULER_STROKE_PX, RULER_TICK_PX } from "../ruler-line";

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
 * The two ends of the line in the layer's normalized world space (base-normalized, like every
 * annotation). The line runs through the middle of the measured row or column, from the first
 * pixel's outer edge to the last pixel's outer edge. The measure is stored in the base ASSET's
 * pixels, so it is mapped through the rect the whole asset covers NOW (`baseFullRect`): it
 * follows the base when that is moved or resized, and with no placement it is `px / image`
 * exactly as before (ADR 0053). The crop never enters: the placement is the whole asset's rect.
 */
export function measureEndpoints(
  a: MeasureAnnotation,
  placement?: BasePlacement,
): { p1: NormPt; p2: NormPt } {
  const f = baseFullRect({ basePlacement: placement });
  const wx = (px: number): number => f.x + (px / a.imageW) * f.w;
  const wy = (px: number): number => f.y + (px / a.imageH) * f.h;
  if (a.axis === "x") {
    const y = wy(a.at + 0.5);
    return { p1: { x: wx(a.from), y }, p2: { x: wx(a.to), y } };
  }
  const x = wx(a.at + 0.5);
  return { p1: { x, y: wy(a.from) }, p2: { x, y: wy(a.to) } };
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
  placement?: BasePlacement,
): Pick<MeasureAnnotation, "from" | "to"> {
  const size = a.axis === "x" ? a.imageW : a.imageH;
  const f = baseFullRect({ basePlacement: placement });
  // The inverse of `measureEndpoints`: world point -> asset px along the axis.
  const edge = Math.round(a.axis === "x" ? ((p.x - f.x) / f.w) * size : ((p.y - f.y) / f.h) * size);
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
  placement?: BasePlacement,
): Pick<MeasureAnnotation, "from" | "to" | "at"> {
  const along = a.axis === "x" ? a.imageW : a.imageH;
  const across = a.axis === "x" ? a.imageH : a.imageW;
  // A world delta covers `scale` of the asset per unit, so divide it back out.
  const { w: k } = baseFullRect({ basePlacement: placement });
  const dAlong = Math.round(((a.axis === "x" ? dx : dy) / k) * along);
  const dAcross = Math.round(((a.axis === "x" ? dy : dx) / k) * across);
  const shift = clamp(dAlong, -a.from, along - a.to);
  return {
    from: a.from + shift,
    to: a.to + shift,
    at: clamp(a.at + dAcross, 0, across - 1),
  };
}

/** Base label font and tick geometry, in display px; the export multiplies them by its scale. */
export const MEASURE_FONT_PX = 12;
export const MEASURE_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** The pinned measure draws exactly the Inspect hover line: same caps, stroke and outline. */
export const MEASURE_TICK_PX = RULER_TICK_PX;
export const MEASURE_STROKE_PX = RULER_STROKE_PX;
export const MEASURE_HALO_PX = RULER_HALO_PX;
const PILL_PAD_X = 6;
const PILL_PAD_Y = 3;
const PILL_GAP = 4;

export interface MeasureShape {
  p1: NormPt;
  p2: NormPt;
  /** Perpendicular end ticks as [x1, y1, x2, y2] segments. */
  ticks: [number, number, number, number][];
  /** Label pill rectangle and the text's centre, in the same space as the endpoints. */
  pill: { x: number; y: number; w: number; h: number; rx: number };
  text: { x: number; y: number; fontSize: number };
}

/**
 * Everything needed to draw a measure, in a pixel space `W`×`H` wide (the layer's size, or the
 * export's natural size) with sizes multiplied by `scale`. One source for the live layer and
 * the export so both draw the same line.
 */
export function measureShape(
  a: MeasureAnnotation,
  W: number,
  H: number,
  scale = 1,
  placement?: BasePlacement,
): MeasureShape {
  const { p1: n1, p2: n2 } = measureEndpoints(a, placement);
  const p1 = { x: n1.x * W, y: n1.y * H };
  const p2 = { x: n2.x * W, y: n2.y * H };
  const t = MEASURE_TICK_PX * scale;
  const ticks: MeasureShape["ticks"] =
    a.axis === "x"
      ? [
          [p1.x, p1.y - t, p1.x, p1.y + t],
          [p2.x, p2.y - t, p2.x, p2.y + t],
        ]
      : [
          [p1.x - t, p1.y, p1.x + t, p1.y],
          [p2.x - t, p2.y, p2.x + t, p2.y],
        ];
  const fontSize = MEASURE_FONT_PX * scale;
  const w = measureLabel(a).length * fontSize * 0.6 + 2 * PILL_PAD_X * scale;
  const h = fontSize + 2 * PILL_PAD_Y * scale;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const gap = PILL_GAP * scale;
  // Above a horizontal line, to the right of a vertical one. Near the image's edge the pill
  // flips to the other side and slides along the line; on an image too small for either side
  // it is clamped inside (it may then cover the line). Only a label larger than the image itself
  // can still be cropped.
  // The label stays inside the asset's own rect: the whole world without a placement, the
  // placed (moved, scaled) asset with one.
  const f = baseFullRect({ basePlacement: placement });
  const x0 = f.x * W;
  const x1 = (f.x + f.w) * W;
  const y0 = f.y * H;
  const y1 = (f.y + f.h) * H;
  const inside = (c: number, half: number, lo: number, hi: number): number =>
    Math.min(Math.max(c, lo + half), Math.max(lo + half, hi - half));
  let cx: number;
  let cy: number;
  if (a.axis === "x") {
    cx = inside(mx, w / 2, x0, x1);
    cy = my - t - gap - h / 2;
    if (cy - h / 2 < y0) cy = inside(my + t + gap + h / 2, h / 2, y0, y1);
  } else {
    cy = inside(my, h / 2, y0, y1);
    cx = mx + t + gap + w / 2;
    if (cx + w / 2 > x1) cx = inside(mx - t - gap - w / 2, w / 2, x0, x1);
  }
  return {
    p1,
    p2,
    ticks,
    pill: { x: cx - w / 2, y: cy - h / 2, w, h, rx: h / 2 },
    text: { x: cx, y: cy, fontSize },
  };
}

/** The pill's text colour: the step badge's ink, so green and yellow pills get dark text
 *  (white on #22c55e is only 2.3:1) and both kinds read the same on every swatch. */
export function measureTextColor(fill: string): string {
  return stepInk(fill);
}
