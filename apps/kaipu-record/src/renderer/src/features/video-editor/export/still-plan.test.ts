import { describe, expect, it } from "vitest";
import { initialScene, type TrackItem } from "../scene";
import { planStill, STILL_END_MARGIN_S } from "./still-plan";

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

// Timeline: slide 0-3 · clip a (src 0-10) 3-13 · clip b (src 20-25, after a cut) 13-18.
const scene = {
  ...initialScene(1),
  items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
  overlays: [
    { id: "o1", kind: "text", x: 0, y: 0, text: "hi", size: 19, color: "#000", start: 4, end: 6 },
  ],
  redactions: [
    {
      id: "r1",
      kind: "blur",
      start: 1,
      end: 2,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      intensity: 50,
      style: "gaussian",
    },
  ],
} as unknown as Parameters<typeof planStill>[0];

describe("planStill", () => {
  it("maps a playhead inside a clip to its source time", () => {
    const p = planStill(scene, 5);
    expect(p.kind).toBe("clip");
    expect(p.timelineSeconds).toBe(5);
    expect(p.sourceSeconds).toBe(2);
  });

  it("maps a playhead after a cut to the later clip's own source window", () => {
    expect(planStill(scene, 15).sourceSeconds).toBe(22);
  });

  it("reports a slide with no source time", () => {
    const p = planStill(scene, 1);
    expect(p.kind).toBe("slide");
    expect(p.sourceSeconds).toBeNull();
  });

  it("keeps the whole plan: redactions and overlay windows are not sliced away", () => {
    const { plan } = planStill(scene, 5);
    expect(plan.totalDuration).toBe(18);
    expect(plan.segments).toHaveLength(3);
    expect(plan.overlayWindows).toEqual([{ overlayId: "o1", start: 4, end: 6 }]);
    expect(plan.redactions.map((r) => r.id)).toEqual(["r1"]);
  });

  it("clamps a playhead at or past the end to just before it, still on the last clip", () => {
    const p = planStill(scene, 18);
    expect(p.timelineSeconds).toBeCloseTo(18 - STILL_END_MARGIN_S);
    expect(p.kind).toBe("clip");
    expect(p.sourceSeconds).toBeLessThan(25);
    expect(planStill(scene, 99).timelineSeconds).toBe(p.timelineSeconds);
  });

  it("clamps a negative or non-finite playhead to the start", () => {
    expect(planStill(scene, -4).timelineSeconds).toBe(0);
    expect(planStill(scene, Number.NaN).timelineSeconds).toBe(0);
  });

  it("refuses an empty timeline", () => {
    expect(() => planStill({ ...initialScene(1), items: [] }, 0)).toThrow();
  });
});
