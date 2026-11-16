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
 * The centre at EASED `progress` before the last-guard clamp into `reach`: what the curve itself
 * gives. Up to 1 it is the Bézier with `progress` as its parameter: exactly `start` at 0 and
 * exactly `end` at 1. Below 0 it is `start`; a non-finite progress counts as 1.
 *
 * Above 1 (Bounce) the curve is NOT extrapolated: the centre is `end + (progress - 1) * T`,
 * where `T = 2 * (end - control)` is the curve's direction and speed as it arrives, so the
 * bubble leaves `end` the way it came in, in a straight line, and comes back along it. The
 * first version's per-axis limit applies with `T` in the place of the straight distance: on
 * each axis the farthest it would go is `peak * |T axis|`; the room is the space between `end`
 * and the edge of `reach` that axis of `T` points to (the sign of `T`'s axis picks the edge,
 * not the sign of end - start). When the farthest point does not fit, that axis's whole travel
 * is multiplied by room / farthest, so the peak lands on the edge and the motion keeps its
 * shape instead of stopping flat. An axis with no room does not go past `end`; the other
 * still does. `peak` is `EASING_PEAK_OVERSHOOT[easing]`.
 *
 * Exported so a test can read the points the curve gives without the clamp.
 */
export function webcamRoutePointBeforeClamp(
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

  let tx = 2 * (end.x - control.x);
  let ty = 2 * (end.y - control.y);
  if (tx === 0 && ty === 0) {
    // The control point sits on `end` (a clamp can do it): a straight route arrives with 2 * (B - A).
    tx = 2 * (end.x - start.x);
    ty = 2 * (end.y - start.y);
  }
  const safePeak = Math.max(0, finiteOr(peak, 0));
  const axis = (endValue: number, t: number, min: number, max: number): number => {
    const room = Math.max(0, t >= 0 ? max - endValue : endValue - min);
    const farthest = safePeak * Math.abs(t);
    const factor = farthest > 0 ? Math.min(1, room / farthest) : 1;
    return endValue + (p - 1) * t * factor;
  };
  return {
    x: axis(end.x, tx, reach.minX, reach.maxX),
    y: axis(end.y, ty, reach.minY, reach.maxY),
  };
}

/**
 * The centre at EASED `progress` (the model's `WebcamState.progress`): the curve's own point
 * ({@link webcamRoutePointBeforeClamp}) held inside `reach`. The clamp is only the last guard;
 * for Smooth, Bounce and Linear it changes no point.
 */
export function webcamRoutePoint(
  route: WebcamRoute,
  progress: number,
  peak: number,
  reach: WebcamRouteReach,
): RoutePoint {
  return clampToReach(webcamRoutePointBeforeClamp(route, progress, peak, reach), reach);
}
