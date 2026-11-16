import { describe, expect, it } from "vitest";
import { EASING_PEAK_OVERSHOOT, easeValue, type EasingPreset } from "./easing";
import type { FrameSize } from "./webcam-layout";
import {
  WEBCAM_ROUTE_BEND,
  webcamRoute,
  webcamRoutePoint,
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

  const tangent = (control: RoutePoint, end: RoutePoint): RoutePoint => {
    const length = distance(control, end);
    return { x: (end.x - control.x) / length, y: (end.y - control.y) / length };
  };

  it("goes past end along the end tangent when there is room", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    const u = tangent(route.control, route.end);
    const point = webcamRoutePoint(route, 1.05, peak, reach);
    const past = (point.x - route.end.x) * u.x + (point.y - route.end.y) * u.y;
    expect(past).toBeGreaterThan(0);
    // 0.05 of the travel, along each axis, with no scaling because the room is large.
    const travel = distance(route.start, route.end);
    expect(point.x).toBeCloseTo(route.end.x + 0.05 * travel * u.x);
    expect(point.y).toBeCloseTo(route.end.y + 0.05 * travel * u.y);
  });

  it("is continuous with end just past 1", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    const point = webcamRoutePoint(route, 1 + 1e-9, peak, reach);
    expect(distance(point, route.end)).toBeLessThan(1e-3);
  });

  it("scales the overshoot down, still moving, when the room is small", () => {
    // End is 12 px from the right edge and the move heads right.
    const start = { x: 1000, y: 540 };
    const end = { x: 1908, y: 540 };
    const route = webcamRoute(start, end, frame, reach);
    const early = webcamRoutePoint(route, 1.03, peak, reach);
    const late = webcamRoutePoint(route, 1.06, peak, reach);
    const top = webcamRoutePoint(route, 1 + peak, peak, reach);
    expect(early.x).toBeGreaterThan(route.end.x);
    expect(late.x).toBeGreaterThan(early.x);
    // The peak uses the room, and not more.
    expect(top.x).toBeLessThanOrEqual(reach.maxX + 1e-6);
    expect(top.x).toBeGreaterThan(late.x);
    // It was scaled, not clamped: the early point is nowhere near the edge.
    expect(early.x).toBeLessThan(reach.maxX - 1);
  });

  it("scales each axis on its own", () => {
    // Plenty of room in y, almost none in x.
    const route = webcamRoute({ x: 1000, y: 300 }, { x: 1900, y: 700 }, frame, reach);
    const u = tangent(route.control, route.end);
    const point = webcamRoutePoint(route, 1 + peak, peak, reach);
    const travel = distance(route.start, route.end);
    const rawY = peak * travel * u.y;
    expect(point.x).toBeLessThanOrEqual(reach.maxX + 1e-6);
    expect(point.x).toBeGreaterThan(route.end.x);
    // y has room, so it keeps its full overshoot.
    expect(point.y - route.end.y).toBeCloseTo(rawY);
  });

  it("does not move past an end that is against the edge", () => {
    const route = webcamRoute({ x: 100, y: 100 }, { x: 1000, y: 100 }, frame, {
      ...reach,
      minY: 100,
      maxY: 980,
    });
    for (const progress of [1.02, 1.05, 1 + peak]) {
      expect(
        inside(webcamRoutePoint(route, progress, peak, { ...reach, minY: 100, maxY: 980 }), {
          ...reach,
          minY: 100,
          maxY: 980,
        }),
      ).toBe(true);
    }
  });

  it("returns end when start equals end", () => {
    const route = webcamRoute({ x: 500, y: 500 }, { x: 500, y: 500 }, frame, reach);
    expect(webcamRoutePoint(route, 1.05, peak, reach)).toEqual({ x: 500, y: 500 });
  });

  it("falls back to the start-to-end direction when control equals end", () => {
    const route = {
      start: { x: 100, y: 500 },
      control: { x: 600, y: 500 },
      end: { x: 600, y: 500 },
    };
    const point = webcamRoutePoint(route, 1.05, peak, reach);
    expect(point.x).toBeCloseTo(600 + 0.05 * 500);
    expect(point.y).toBeCloseTo(500);
  });

  it("guards a progress far beyond the peak with the clamp", () => {
    const route = webcamRoute({ x: 400, y: 400 }, { x: 900, y: 600 }, frame, reach);
    expect(inside(webcamRoutePoint(route, 50, peak, reach), reach)).toBe(true);
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
