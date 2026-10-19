import { describe, expect, it } from "vitest";
import { initialScene, type TrackItem } from "../scene";
import {
  buildExportPlan,
  gifFrameSchedule,
  gifOutputSize,
  gifRangeProblem,
  locateTimelineTime,
  sliceExportPlan,
} from "./export-plan";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});

const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `asset-${id}`,
  duration,
  naturalWidth: 800,
  naturalHeight: 600,
});

const overlay = (id: string, start: number, end: number) =>
  ({ id, kind: "text", x: 0, y: 0, text: id, size: 19, color: "#000", start, end }) as const;

describe("sliceExportPlan", () => {
  // Timeline: slide 0–3 · clip a (src 0–10) 3–13 · clip b (src 20–25, after a cut) 13–18.
  const plan = buildExportPlan({
    ...initialScene(1),
    items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
    overlays: [overlay("o1", 1, 4), overlay("o2", 12, 16), overlay("o3", 17, 18)],
  });

  it("clips segments to a range across a cut and rebases them to 0", () => {
    const sliced = sliceExportPlan(plan, 11, 15);
    expect(sliced.totalDuration).toBe(4);
    expect(sliced.segments).toEqual([
      { kind: "clip", timelineStart: 0, duration: 2, sourceStart: 8, sourceEnd: 10 },
      // Content AFTER the cut is included, from its own source window.
      { kind: "clip", timelineStart: 2, duration: 2, sourceStart: 20, sourceEnd: 22 },
    ]);
  });

  it("clips a slide and keeps its asset", () => {
    const sliced = sliceExportPlan(plan, 2, 4);
    expect(sliced.segments).toEqual([
      { kind: "slide", timelineStart: 0, duration: 1, assetId: "asset-s1" },
      { kind: "clip", timelineStart: 1, duration: 1, sourceStart: 0, sourceEnd: 1 },
    ]);
  });

  it("clips overlay windows to the range and drops the ones outside", () => {
    const sliced = sliceExportPlan(plan, 2, 6);
    expect(sliced.overlayWindows).toEqual([{ overlayId: "o1", start: 0, end: 2 }]);
    expect(sliceExportPlan(plan, 13, 16).overlayWindows).toEqual([
      { overlayId: "o2", start: 0, end: 3 },
    ]);
  });

  it("clamps the range to the timeline and keeps source-time data", () => {
    const sliced = sliceExportPlan(plan, 16, 99);
    expect(sliced.totalDuration).toBe(2);
    expect(sliced.redactions).toBe(plan.redactions);
    expect(sliced.hasZoom).toBe(plan.hasZoom);
  });

  it("is the identity on the whole timeline", () => {
    const sliced = sliceExportPlan(plan, 0, plan.totalDuration);
    expect(sliced.segments).toEqual(plan.segments);
    expect(sliced.totalDuration).toBe(plan.totalDuration);
  });
});

describe("gifFrameSchedule", () => {
  it("uses 7/7/6 cs at 15 fps", () => {
    const slots = gifFrameSchedule(1, 15);
    expect(slots).toHaveLength(15);
    expect(slots.slice(0, 6).map((s) => s.delayCs)).toEqual([7, 7, 6, 7, 7, 6]);
    expect(slots.reduce((sum, s) => sum + s.delayCs, 0)).toBe(100);
  });

  it("uses 10 cs at 10 fps", () => {
    const slots = gifFrameSchedule(3, 10);
    expect(slots).toHaveLength(30);
    expect(new Set(slots.map((s) => s.delayCs))).toEqual(new Set([10]));
  });

  it.each([
    [4, 15],
    [4.03, 15],
    [29.97, 15],
    [0.5, 10],
    [12.34, 10],
  ])("sums to %s s ± one frame at %s fps", (duration, fps) => {
    const slots = gifFrameSchedule(duration, fps);
    const total = slots.reduce((sum, s) => sum + s.delayCs, 0) / 100;
    expect(Math.abs(total - duration)).toBeLessThanOrEqual(1 / fps);
    slots.forEach((slot, i) => expect(slot.t).toBeCloseTo(i / fps, 9));
  });
});

describe("locateTimelineTime", () => {
  const plan = buildExportPlan({
    ...initialScene(1),
    items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
    overlays: [],
  });

  it("maps timeline time to a segment and source time", () => {
    expect(locateTimelineTime(plan, 1)?.segment.kind).toBe("slide");
    expect(locateTimelineTime(plan, 5)?.sourceTime).toBe(2);
    expect(locateTimelineTime(plan, 13)?.sourceTime).toBe(20);
    expect(locateTimelineTime(plan, 18)?.sourceTime).toBe(25);
    expect(locateTimelineTime(plan, 19)).toBeNull();
  });
});

describe("gifOutputSize", () => {
  it("keeps the aspect ratio with even dimensions", () => {
    expect(gifOutputSize(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(gifOutputSize(1512, 982, 480)).toEqual({ width: 480, height: 312 });
  });

  it("never upscales past the source width", () => {
    expect(gifOutputSize(600, 400, 800)).toEqual({ width: 600, height: 400 });
  });
});

describe("gifRangeProblem", () => {
  const limits = { min: 0.5, max: 30 };
  it("blocks ranges under 0.5 s and over 30 s", () => {
    expect(gifRangeProblem(1, 1.4, limits)).toBe("too-short");
    expect(gifRangeProblem(0, 30.5, limits)).toBe("too-long");
    expect(gifRangeProblem(0, 30, limits)).toBeNull();
    expect(gifRangeProblem(2, 2.5, limits)).toBeNull();
  });
});
