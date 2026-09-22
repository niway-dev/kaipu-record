import { describe, expect, it } from "vitest";
import { initialScene, type TrackItem } from "../scene";
import { buildExportPlan } from "./export-plan";

// Copied from timeline.test.ts — the same fixture factories, kept local so this
// test file has no cross-test-file coupling.
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

describe("buildExportPlan", () => {
  it("maps the track to contiguous render segments", () => {
    const plan = buildExportPlan({
      ...initialScene(1),
      items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
      overlays: [],
    });
    expect(plan.totalDuration).toBe(18);
    expect(plan.segments).toEqual([
      { kind: "slide", timelineStart: 0, duration: 3, assetId: "asset-s1" },
      { kind: "clip", timelineStart: 3, duration: 10, sourceStart: 0, sourceEnd: 10 },
      { kind: "clip", timelineStart: 13, duration: 5, sourceStart: 20, sourceEnd: 25 },
    ]);
  });

  it("carries overlay windows in scene order", () => {
    const overlays = [
      {
        id: "o1",
        kind: "text",
        x: 0,
        y: 0,
        text: "hola",
        size: 19,
        color: "#000",
        start: 1,
        end: 4,
      },
    ] as const;
    const plan = buildExportPlan({
      ...initialScene(1),
      items: [clip("a", 0, 10)],
      overlays: [...overlays],
    });
    expect(plan.overlayWindows).toEqual([{ overlayId: "o1", start: 1, end: 4 }]);
  });

  it("throws on an empty timeline", () => {
    expect(() => buildExportPlan({ ...initialScene(1), items: [], overlays: [] })).toThrow();
  });
});
