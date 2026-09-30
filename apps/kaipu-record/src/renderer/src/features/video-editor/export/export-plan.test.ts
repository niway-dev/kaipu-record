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

  it("carries only visible redactions, but flags a zoom even inside a cut (v2)", () => {
    const base = initialScene(30);
    const plan = buildExportPlan({
      ...base,
      items: [clip("a", 0, 10), clip("b", 20, 30)],
      redactions: [
        {
          id: "kept",
          kind: "cover",
          start: 2,
          end: 4,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          fill: "#18181b",
          label: "",
        },
        {
          id: "cut",
          kind: "cover",
          start: 12,
          end: 18,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          fill: "#18181b",
          label: "",
        },
      ],
      zoomSegments: [
        {
          id: "z",
          start: 12,
          end: 15,
          scale: 2,
          mode: "follow",
          anchor: null,
          smoothing: 70,
          origin: "auto",
          trigger: "click",
        },
      ],
    });
    expect(plan.redactions.map((r) => r.id)).toEqual(["kept"]);
    // The zoom lies in deleted footage, yet lookahead + ease-out still carry the camera
    // over the kept frames on either side of the cut — the preview zooms there, so the
    // export needs the path too.
    expect(plan.hasZoom).toBe(true);
  });
});

describe("audio edits reach the export plan", () => {
  it("carries nothing muted for a fresh scene", () => {
    const plan = buildExportPlan(initialScene(30));
    expect(plan.audio).toEqual({ audioMuted: false, mutedRanges: [] });
  });

  it("carries a whole-video mute", () => {
    const scene = { ...initialScene(30), audioMuted: true };
    expect(buildExportPlan(scene).audio.audioMuted).toBe(true);
  });

  it("keeps a range that sits entirely in deleted footage", () => {
    // Unlike redactions, ranges are not filtered by visibility: they are clipped
    // per segment at write time, so one inside a cut costs nothing and comes
    // back if the cut is undone.
    const scene = {
      ...initialScene(30),
      items: [clip("a", 0, 5), clip("b", 20, 30)],
      mutedRanges: [{ id: "m", sourceStart: 10, sourceEnd: 15 }],
    };
    expect(buildExportPlan(scene).audio.mutedRanges).toHaveLength(1);
  });
});
