import { describe, expect, it } from "vitest";
import { joinedSource } from "../media-switch.fixture";
import { initialScene, type ImageMediaItem, type TrackItem } from "../scene";
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

  it("keeps only the floating images on screen at the playhead", () => {
    const image = (id: string, time: number, z: number): ImageMediaItem => ({
      id,
      kind: "image",
      assetId: `asset-${id}`,
      naturalWidth: 100,
      naturalHeight: 100,
      anchor: { kind: "source", time },
      duration: 2,
      box: { x: 0.5, y: 0.5, width: 0.4 },
      z,
      fadeInMs: 0,
      fadeOutMs: 0,
    });
    // On the timeline: early 4-6 (source 1-3), late 9-11 (source 6-8).
    const withMedia = { ...scene, media: [image("early", 1, 0), image("late", 6, 1)] };
    expect(planStill(withMedia, 5).plan.floating?.items.map((i) => i.id)).toEqual(["early"]);
    expect(planStill(withMedia, 10).plan.floating?.items.map((i) => i.id)).toEqual(["late"]);
    expect(planStill(withMedia, 7.5).plan.floating).toBeUndefined();
  });
});

describe("planStill with two recordings", () => {
  const two = {
    ...initialScene(100),
    sources: [joinedSource("b", 3600, 40)],
    items: [clip("a1", 0, 10), clip("b", 3600, 3610), clip("a2", 50, 60)],
  };

  it("returns the recording under the playhead next to the axis second", () => {
    const p = planStill(two, 14);
    expect(p.sourceId).toBe("b");
    expect(p.sourceSeconds).toBe(3604);
  });

  it("returns null for the opened recording and for a slide", () => {
    expect(planStill(two, 5).sourceId).toBeNull();
    expect(planStill(scene, 1).sourceId).toBeNull();
  });
});
