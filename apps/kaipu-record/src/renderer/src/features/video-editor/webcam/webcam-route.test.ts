import { describe, expect, it } from "vitest";
import { EASING_PEAK_OVERSHOOT, easeValue, type EasingPreset } from "./easing";
import type { FrameSize } from "./webcam-layout";
import {
  WEBCAM_ROUTE_BEND,
  webcamRoute,
  webcamRoutePoint,
  webcamRoutePointBeforeClamp,
  type RoutePoint,
  type WebcamRouteReach,
} from "./webcam-route";

const LANDSCAPE: FrameSize = { width: 1920, height: 1080 };
const PORTRAIT: FrameSize = { width: 1080, height: 1920 };

/** The whole frame is reachable: no bubble inset. */
const fullReach = (frame: FrameSize): WebcamRouteReach => ({
  minX: 0,
  maxX: frame.width,
  minY: 0,
  maxY: frame.height,
});

/** A bubble of about 200 px: its centre stays 100 px from every edge. */
const insetReach = (frame: FrameSize): WebcamRouteReach => ({
  minX: 100,
  maxX: frame.width - 100,
  minY: 100,
  maxY: frame.height - 100,
});

const midpoint = (a: RoutePoint, b: RoutePoint): RoutePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const distance = (a: RoutePoint, b: RoutePoint): number => Math.hypot(a.x - b.x, a.y - b.y);

const inside = (point: RoutePoint, reach: WebcamRouteReach): boolean =>
  point.x >= reach.minX - 1e-9 &&
  point.x <= reach.maxX + 1e-9 &&
  point.y >= reach.minY - 1e-9 &&
  point.y <= reach.maxY + 1e-9;

describe("webcamRoute control side", () => {
  it("bends a move along the top edge downward, toward the centre", () => {
    const reach = insetReach(LANDSCAPE);
    const route = webcamRoute({ x: 100, y: 100 }, { x: 1000, y: 100 }, LANDSCAPE, {
      ...reach,
      maxY: 1000,
    });
    expect(route.control.x).toBeCloseTo(550);
    expect(route.control.y).toBeCloseTo(100 + 900 * WEBCAM_ROUTE_BEND);
  });

  it("bends a move along the bottom edge upward", () => {
    const route = webcamRoute(
      { x: 100, y: 980 },
      { x: 1000, y: 980 },
      LANDSCAPE,
      fullReach(LANDSCAPE),
    );
    expect(route.control.x).toBeCloseTo(550);
    expect(route.control.y).toBeCloseTo(980 - 900 * WEBCAM_ROUTE_BEND);
  });

  it("bends a move along the left edge to the right", () => {
    const route = webcamRoute(
      { x: 100, y: 100 },
      { x: 100, y: 900 },
      LANDSCAPE,
      fullReach(LANDSCAPE),
    );
    expect(route.control.x).toBeCloseTo(100 + 800 * WEBCAM_ROUTE_BEND);
    expect(route.control.y).toBeCloseTo(500);
  });

  it("bends a move along the right edge to the left", () => {
    const route = webcamRoute(
      { x: 1820, y: 100 },
      { x: 1820, y: 900 },
      LANDSCAPE,
      fullReach(LANDSCAPE),
    );
    expect(route.control.x).toBeCloseTo(1820 - 800 * WEBCAM_ROUTE_BEND);
    expect(route.control.y).toBeCloseTo(500);
  });

  it("uses the mock's side when both sides are equally near the centre", () => {
    const frame: FrameSize = { width: 1000, height: 1000 };
    // Along the centre line: both candidates are the same distance from the centre.
    const horizontal = webcamRoute({ x: 300, y: 500 }, { x: 700, y: 500 }, frame, fullReach(frame));
    expect(horizontal.control.x).toBeCloseTo(500);
    expect(horizontal.control.y).toBeCloseTo(500 + 400 * 0.18);
    // A diagonal through the centre.
    const diagonal = webcamRoute({ x: 300, y: 300 }, { x: 700, y: 700 }, frame, fullReach(frame));
    expect(diagonal.control.x).toBeCloseTo(500 - 400 * 0.18);
    expect(diagonal.control.y).toBeCloseTo(500 + 400 * 0.18);
  });

  it("puts the control point on the point when start equals end", () => {
    const route = webcamRoute(
      { x: 640, y: 360 },
      { x: 640, y: 360 },
      LANDSCAPE,
      fullReach(LANDSCAPE),
    );
    expect(route.control).toEqual({ x: 640, y: 360 });
  });

  it("measures the bend in pixels, the same on a landscape and a portrait frame", () => {
    const cases: Array<[FrameSize, RoutePoint, RoutePoint]> = [
      [LANDSCAPE, { x: 400, y: 300 }, { x: 1100, y: 500 }],
      [PORTRAIT, { x: 300, y: 400 }, { x: 500, y: 1100 }],
    ];
    for (const [frame, start, end] of cases) {
      const route = webcamRoute(start, end, frame, fullReach(frame));
      const mid = midpoint(start, end);
      expect(distance(route.control, mid)).toBeCloseTo(WEBCAM_ROUTE_BEND * distance(start, end));
      // The offset is perpendicular to the move.
      const dot =
        (route.control.x - mid.x) * (end.x - start.x) +
        (route.control.y - mid.y) * (end.y - start.y);
      expect(dot).toBeCloseTo(0);
    }
  });

  it("clamps the control point into reach", () => {
    const reach: WebcamRouteReach = { minX: 100, maxX: 1820, minY: 100, maxY: 130 };
    const route = webcamRoute({ x: 100, y: 100 }, { x: 900, y: 100 }, LANDSCAPE, reach);
    // Unclamped it would sit 144 px below the line.
    expect(route.control.y).toBe(130);
    expect(route.control.x).toBeCloseTo(500);
    const narrow: WebcamRouteReach = { minX: 600, maxX: 700, minY: 0, maxY: 1080 };
    const clamped = webcamRoute({ x: 600, y: 200 }, { x: 700, y: 900 }, LANDSCAPE, narrow);
    expect(clamped.control.x).toBeGreaterThanOrEqual(600);
    expect(clamped.control.x).toBeLessThanOrEqual(700);
  });

  it("keeps start and end as given", () => {
    const start = { x: 210, y: 320 };
    const end = { x: 1400, y: 700 };
    const route = webcamRoute(start, end, LANDSCAPE, fullReach(LANDSCAPE));
    expect(route.start).toEqual(start);
    expect(route.end).toEqual(end);
  });
});

describe("webcamRoutePoint up to 1", () => {
  const reach = fullReach(LANDSCAPE);
  const route = webcamRoute({ x: 200, y: 300 }, { x: 1200, y: 700 }, LANDSCAPE, reach);

  it("is exactly start at progress 0 and exactly end at progress 1", () => {
    expect(webcamRoutePoint(route, 0, 0, reach)).toEqual(route.start);
    expect(webcamRoutePoint(route, 1, 0, reach)).toEqual(route.end);
  });

  it("holds progress below 0 at start", () => {
    expect(webcamRoutePoint(route, -0.5, 0, reach)).toEqual(route.start);
  });

  it("matches the quadratic Bézier formula at progress 0.5", () => {
    const point = webcamRoutePoint(route, 0.5, 0, reach);
    expect(point.x).toBeCloseTo(0.25 * route.start.x + 0.5 * route.control.x + 0.25 * route.end.x);
    expect(point.y).toBeCloseTo(0.25 * route.start.y + 0.5 * route.control.y + 0.25 * route.end.y);
  });

  it("matches the formula at an arbitrary progress", () => {
    const t = 0.3;
    const point = webcamRoutePoint(route, t, 0, reach);
    const s = 1 - t;
    expect(point.x).toBeCloseTo(
      s * s * route.start.x + 2 * s * t * route.control.x + t * t * route.end.x,
    );
    expect(point.y).toBeCloseTo(
      s * s * route.start.y + 2 * s * t * route.control.y + t * t * route.end.y,
    );
  });

  it("leaves the straight line (the route is curved)", () => {
    const point = webcamRoutePoint(route, 0.5, 0, reach);
    const mid = midpoint(route.start, route.end);
    expect(distance(point, mid)).toBeGreaterThan(1);
  });
});

describe("webcamRoutePoint stays inside reach", () => {
  const SAMPLES = 80;
  const motions: Array<[string, EasingPreset]> = [
    ["Smooth", "ease-in-out"],
    ["Linear", "linear"],
    ["Bounce", "back"],
  ];

  const routesFor = (
    frame: FrameSize,
    reach: WebcamRouteReach,
  ): Array<[string, RoutePoint, RoutePoint]> => [
    ["along the top edge", { x: reach.minX, y: reach.minY }, { x: reach.maxX, y: reach.minY }],
    ["along the bottom edge", { x: reach.maxX, y: reach.maxY }, { x: reach.minX, y: reach.maxY }],
    ["along the left edge", { x: reach.minX, y: reach.minY }, { x: reach.minX, y: reach.maxY }],
    ["along the right edge", { x: reach.maxX, y: reach.maxY }, { x: reach.maxX, y: reach.minY }],
    ["corner to corner", { x: reach.minX, y: reach.minY }, { x: reach.maxX, y: reach.maxY }],
    ["the other diagonal", { x: reach.maxX, y: reach.minY }, { x: reach.minX, y: reach.maxY }],
    [
      "a short move near a corner",
      { x: reach.minX + 10, y: reach.minY + 10 },
      { x: reach.minX + 40, y: reach.minY + 15 },
    ],
    [
      "a short move from an edge into the frame",
      { x: reach.maxX, y: frame.height / 2 },
      { x: reach.maxX - 30, y: frame.height / 2 + 20 },
    ],
    [
      "through the centre",
      { x: reach.minX, y: frame.height / 2 },
      { x: reach.maxX, y: frame.height / 2 },
    ],
  ];

  for (const [frameName, frame] of [
    ["landscape", LANDSCAPE],
    ["vertical", PORTRAIT],
  ] as const) {
    for (const [reachName, reach] of [
      ["the full frame", fullReach(frame)],
      ["an inset frame", insetReach(frame)],
    ] as const) {
      for (const [motionName, easing] of motions) {
        it(`keeps every ${motionName} point inside ${reachName} on a ${frameName} frame`, () => {
          const peak = EASING_PEAK_OVERSHOOT[easing];
          for (const [name, start, end] of routesFor(frame, reach)) {
            const route = webcamRoute(start, end, frame, reach);
            expect(inside(route.control, reach), `${name}: control`).toBe(true);
            for (let i = 0; i <= SAMPLES; i += 1) {
              const progress = easeValue(easing, i / SAMPLES);
              const point = webcamRoutePoint(route, progress, peak, reach);
              expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
              expect(inside(point, reach), `${name} at ${i}/${SAMPLES}`).toBe(true);
              // The clamp is only the last guard: the curve is already inside, so it changes nothing.
              const raw = webcamRoutePointBeforeClamp(route, progress, peak, reach);
              expect(inside(raw, reach), `${name} before the clamp at ${i}/${SAMPLES}`).toBe(true);
              expect(raw, `${name}: the clamp changed a point at ${i}/${SAMPLES}`).toEqual(point);
            }
          }
        });
      }
    }
  }
});

describe("webcamRoutePoint beyond 1 (Bounce)", () => {
  const peak = EASING_PEAK_OVERSHOOT.back;
  const frame = LANDSCAPE;
  const reach = fullReach(frame);

  /** The curve's direction and speed as it arrives: twice the vector from the control point to B. */
  const arrival = (route: { control: RoutePoint; end: RoutePoint }): RoutePoint => ({
    x: 2 * (route.end.x - route.control.x),
    y: 2 * (route.end.y - route.control.y),
  });

  it("is B + (p - 1) x T, with T = 2 x (B - control), when there is room", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    const t = arrival(route);
    const point = webcamRoutePoint(route, 1.05, peak, reach);
    expect(point.x).toBeCloseTo(route.end.x + 0.05 * t.x);
    expect(point.y).toBeCloseTo(route.end.y + 0.05 * t.y);
  });

  it("does not extrapolate the quadratic: it leaves B in a straight line along T", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    const t = arrival(route);
    const near = webcamRoutePoint(route, 1.02, peak, reach);
    const far = webcamRoutePoint(route, 1.08, peak, reach);
    // Both points lie on the line through B with direction T: the cross product is zero.
    const cross = (p: RoutePoint): number => (p.x - route.end.x) * t.y - (p.y - route.end.y) * t.x;
    expect(cross(near)).toBeCloseTo(0, 6);
    expect(cross(far)).toBeCloseTo(0, 6);
  });

  it("is continuous with B just past 1", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    const point = webcamRoutePoint(route, 1 + 1e-9, peak, reach);
    expect(distance(point, route.end)).toBeLessThan(1e-3);
  });

  it("scales each axis to the room, so the peak lands on the edge and the motion keeps its shape", () => {
    // End is 12 px from the right edge and the move heads right; y has plenty of room.
    const route = webcamRoute({ x: 1000, y: 540 }, { x: 1908, y: 540 }, frame, reach);
    const t = arrival(route);
    expect(t.x).toBeGreaterThan(0);
    const half = webcamRoutePoint(route, 1 + peak / 2, peak, reach);
    const top = webcamRoutePoint(route, 1 + peak, peak, reach);
    // The peak uses the room exactly: on the edge, not flat against it before the peak.
    expect(top.x).toBeCloseTo(reach.maxX, 6);
    expect(half.x).toBeGreaterThan(route.end.x);
    expect(half.x).toBeLessThan(reach.maxX - 1);
    // y fits whole, so it keeps its full travel (no scaling on that axis).
    expect(top.y).toBeCloseTo(route.end.y + peak * t.y, 6);
  });

  it("picks the edge by the sign of T's axis, not by the sign of B - A", () => {
    // A -> B heads right by 20 px, but the curve arrives heading LEFT on x (T.x < 0).
    const route = webcamRoute({ x: 500, y: 500 }, { x: 520, y: 900 }, frame, {
      ...reach,
      minX: 519.9,
    });
    const limited = { ...reach, minX: 519.9 };
    const t = arrival(route);
    expect(route.end.x - route.start.x).toBeGreaterThan(0);
    expect(t.x).toBeLessThan(0);
    const top = webcamRoutePoint(route, 1 + peak, peak, limited);
    // The room on the left is 0.1 px: the peak lands there, and it does not run right.
    expect(top.x).toBeCloseTo(limited.minX, 6);
    expect(top.x).toBeLessThan(route.end.x);
  });

  it("does not go past B on an axis with no room, while the other axis still does", () => {
    // B is on the right edge and T points right; y has room.
    const route = webcamRoute({ x: 1000, y: 200 }, { x: 1920, y: 300 }, frame, reach);
    const t = arrival(route);
    expect(t.x).toBeGreaterThan(0);
    expect(t.y).not.toBe(0);
    for (const progress of [1.02, 1.05, 1 + peak]) {
      const point = webcamRoutePointBeforeClamp(route, progress, peak, reach);
      expect(point.x).toBe(route.end.x);
      expect(Math.abs(point.y - route.end.y)).toBeGreaterThan(0);
    }
  });

  for (const [name, start, end] of [
    ["a corner", { x: 400, y: 300 }, { x: 1820, y: 980 }],
    ["the top edge", { x: 200, y: 100 }, { x: 1700, y: 100 }],
    ["the right edge", { x: 1820, y: 200 }, { x: 1820, y: 900 }],
    ["a short move into an edge", { x: 1700, y: 540 }, { x: 1815, y: 520 }],
  ] as Array<[string, RoutePoint, RoutePoint]>) {
    it(`Bounce into ${name} is inside before the last-guard clamp and is past B on every axis with room`, () => {
      const inset = insetReach(frame);
      const route = webcamRoute(start, end, frame, inset);
      const t = arrival(route);
      for (let i = 0; i <= 80; i += 1) {
        const progress = easeValue("back", i / 80);
        const raw = webcamRoutePointBeforeClamp(route, progress, peak, inset);
        expect(inside(raw, inset), `${name} at ${i}/80`).toBe(true);
        expect(webcamRoutePoint(route, progress, peak, inset)).toEqual(raw);
      }
      // Around the peak: past B, in T's direction, on each axis that has room.
      const around = webcamRoutePointBeforeClamp(route, 1 + peak, peak, inset);
      const roomX = t.x >= 0 ? inset.maxX - route.end.x : route.end.x - inset.minX;
      const roomY = t.y >= 0 ? inset.maxY - route.end.y : route.end.y - inset.minY;
      if (roomX > 1e-6 && t.x !== 0) {
        expect(Math.sign(around.x - route.end.x)).toBe(Math.sign(t.x));
      } else {
        expect(around.x).toBe(route.end.x);
      }
      if (roomY > 1e-6 && t.y !== 0) {
        expect(Math.sign(around.y - route.end.y)).toBe(Math.sign(t.y));
      } else {
        expect(around.y).toBe(route.end.y);
      }
    });
  }

  it("returns B when start equals end", () => {
    const route = webcamRoute({ x: 500, y: 500 }, { x: 500, y: 500 }, frame, reach);
    expect(webcamRoutePoint(route, 1.05, peak, reach)).toEqual({ x: 500, y: 500 });
  });

  it("falls back to 2 x (B - A) when the control point sits on B", () => {
    const route = {
      start: { x: 100, y: 500 },
      control: { x: 600, y: 500 },
      end: { x: 600, y: 500 },
    };
    const point = webcamRoutePoint(route, 1.05, peak, reach);
    expect(point.x).toBeCloseTo(600 + 0.05 * 1000);
    expect(point.y).toBeCloseTo(500);
  });

  it("guards a progress far beyond the peak with the clamp", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    expect(inside(webcamRoutePoint(route, 50, peak, reach), reach)).toBe(true);
    expect(inside(webcamRoutePointBeforeClamp(route, 50, peak, reach), reach)).toBe(false);
  });
});

describe("webcamRoutePoint with bad input", () => {
  const reach = fullReach(LANDSCAPE);
  const route = webcamRoute({ x: 200, y: 300 }, { x: 1200, y: 700 }, LANDSCAPE, reach);

  it("treats a non-finite progress as 1", () => {
    for (const progress of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(webcamRoutePoint(route, progress, 0.1, reach)).toEqual(route.end);
    }
  });

  it("does not throw or return NaN for non-finite points", () => {
    const bad = webcamRoute(
      { x: Number.NaN, y: 10 },
      { x: Number.POSITIVE_INFINITY, y: 20 },
      LANDSCAPE,
      reach,
    );
    for (const progress of [0, 0.5, 1, 1.05]) {
      const point = webcamRoutePoint(bad, progress, 0.1, reach);
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe("determinism", () => {
  it("gives identical output for identical input, so preview and export agree", () => {
    const reach = insetReach(LANDSCAPE);
    const start = { x: 321.5, y: 210.25 };
    const end = { x: 1500.75, y: 800 };
    const first = webcamRoute(start, end, LANDSCAPE, reach);
    const second = webcamRoute(start, end, LANDSCAPE, reach);
    expect(second).toEqual(first);
    const peak = EASING_PEAK_OVERSHOOT.back;
    for (let i = 0; i <= 60; i += 1) {
      const progress = easeValue("back", i / 60);
      expect(webcamRoutePoint(second, progress, peak, reach)).toEqual(
        webcamRoutePoint(first, progress, peak, reach),
      );
    }
  });
});
