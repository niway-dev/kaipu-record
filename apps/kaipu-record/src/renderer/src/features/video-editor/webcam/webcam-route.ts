/**
 * The curved route a camera part's bubble slides along: a quadratic curve from the previous
 * position to the part's position. The preview draws and plays this route and the export plays
 * it too, so this file holds the one function for the geometry.
 *
 * WORKER-BUNDLE INVARIANT, like easing.ts and webcam-layout.ts: pure and DOM-free, with no
 * value import at all (only the `FrameSize` TYPE from `./webcam-layout`), so the export
 * worker can bundle it. The easing's `peak` comes in as a number.
 */
import type { FrameSize } from "./webcam-layout";

/** How far the control point leaves the straight line, as a fraction of the distance A to B. */
export const WEBCAM_ROUTE_BEND = 0.18;

/** A position in FRAME PIXELS. */
export interface RoutePoint {
  x: number;
  y: number;
}

/** The range the bubble's CENTRE can reach, in pixels (the frame minus half the bubble). */
export interface WebcamRouteReach {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A quadratic Bézier: `start` and `end` are bubble centres in frame pixels. */
export interface WebcamRoute {
  start: RoutePoint;
  control: RoutePoint;
  end: RoutePoint;
}

/** Two squared distances closer than this are the same distance: the mock's side decides. */
const TIE_EPSILON = 1e-9;

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampToReach = (point: RoutePoint, reach: WebcamRouteReach): RoutePoint => ({
  x: clamp(point.x, reach.minX, reach.maxX),
  y: clamp(point.y, reach.minY, reach.maxY),
});

const sanitize = (point: RoutePoint): RoutePoint => ({
  x: finiteOr(point.x, 0),
  y: finiteOr(point.y, 0),
});

/**
 * The curve from `start` to `end`. The control point is the midpoint moved sideways, in
 * PIXELS, by {@link WEBCAM_ROUTE_BEND} of the distance, so the arc is the same on any aspect
 * ratio. The side is the one nearer the centre of the frame; when both are equally near, the
 * owner's mock side. The control point is then clamped into `reach`, so with `start` and
 * `end` inside it the whole curve stays inside by convexity. `start == end` gives a control
 * point on `start`.
 */
export function webcamRoute(
  start: RoutePoint,
  end: RoutePoint,
  frame: FrameSize,
  reach: WebcamRouteReach,
): WebcamRoute {
  const a = sanitize(start);
  const b = sanitize(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // The mock's side, and its opposite: the two perpendicular directions.
  const mock = { x: mid.x - dy * WEBCAM_ROUTE_BEND, y: mid.y + dx * WEBCAM_ROUTE_BEND };
  const other = { x: mid.x + dy * WEBCAM_ROUTE_BEND, y: mid.y - dx * WEBCAM_ROUTE_BEND };
  const centerX = finiteOr(frame.width, 0) / 2;
  const centerY = finiteOr(frame.height, 0) / 2;
  const squaredFromCenter = (p: RoutePoint): number => (p.x - centerX) ** 2 + (p.y - centerY) ** 2;
  const mockDistance = squaredFromCenter(mock);
  const otherDistance = squaredFromCenter(other);
  const tied = Math.abs(mockDistance - otherDistance) < TIE_EPSILON;
  const control = tied || mockDistance < otherDistance ? mock : other;
  return { start: a, control: clampToReach(control, reach), end: b };
}

/**
 * The centre at EASED `progress` (the model's `WebcamState.progress`). Up to 1 it is the
 * Bézier with `progress` as its parameter: exactly `start` at 0 and exactly `end` at 1. Below
 * 0 it is `start`; a non-finite progress counts as 1.
 *
 * Beyond 1 (Bounce) the bubble travels past `end` along the curve's end tangent, by
 * `(progress - 1) * |end - start|`. Each axis is scaled on its own so the easing's PEAK uses at
 * most the room before the frame edge that way (the first version's rule): the motion keeps
 * its shape instead of stopping flat against the edge. A clamp into `reach` stays only as the
 * last guard. `peak` is `EASING_PEAK_OVERSHOOT[easing]`.
 */
export function webcamRoutePoint(
  route: WebcamRoute,
  progress: number,
  peak: number,
  reach: WebcamRouteReach,
): RoutePoint {
  const { start, control, end } = route;
  const p = Number.isFinite(progress) ? progress : 1;
  if (p <= 0) return { x: start.x, y: start.y };
  if (p === 1) return { x: end.x, y: end.y };
  if (p < 1) {
    const inverse = 1 - p;
    const weightStart = inverse * inverse;
    const weightControl = 2 * inverse * p;
    const weightEnd = p * p;
    return {
      x: weightStart * start.x + weightControl * control.x + weightEnd * end.x,
      y: weightStart * start.y + weightControl * control.y + weightEnd * end.y,
    };
  }

  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  let tx = end.x - control.x;
  let ty = end.y - control.y;
  let length = Math.hypot(tx, ty);
  if (length === 0) {
    tx = end.x - start.x;
    ty = end.y - start.y;
    length = Math.hypot(tx, ty);
  }
  if (length === 0 || distance === 0) return clampToReach(end, reach);
  const ux = tx / length;
  const uy = ty / length;
  const safePeak = Math.max(0, finiteOr(peak, 0));
  const axis = (endValue: number, u: number, min: number, max: number): number => {
    const room = Math.max(0, u >= 0 ? max - endValue : endValue - min);
    const reachPeak = safePeak * distance * Math.abs(u);
    const factor = reachPeak > 0 ? Math.min(1, room / reachPeak) : 1;
    return endValue + (p - 1) * distance * u * factor;
  };
  return clampToReach(
    {
      x: axis(end.x, ux, reach.minX, reach.maxX),
      y: axis(end.y, uy, reach.minY, reach.maxY),
    },
    reach,
  );
}
