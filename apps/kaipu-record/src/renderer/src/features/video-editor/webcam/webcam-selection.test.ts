import { describe, expect, it } from "vitest";
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import { WEBCAM_DEFAULTS, type WebcamScene, type WebcamSegment } from "./webcam-model";
import { toLayout } from "../timeline";
import { webcamInspectorTarget, webcamOutlined, webcamSelectSeekTarget } from "./webcam-selection";

const hidden: WebcamSegment = { id: "h", start: 2, end: 4, mode: "hidden" };
const custom: WebcamSegment = {
  id: "o",
  start: 6,
  end: 8,
  mode: "override",
  layout: { size: 0.3 },
};
const webcam: WebcamScene = { layout: WEBCAM_DEFAULTS, segments: [hidden, custom] };

describe("webcamOutlined", () => {
  it("outlines the bubble for the layer and for an override: both are its look", () => {
    expect(webcamOutlined(webcam, WEBCAM_LAYER_SELECTION)).toBe(true);
    expect(webcamOutlined(webcam, "o")).toBe(true);
  });

  it("does not outline it for a hidden range, an unknown id or no selection", () => {
    expect(webcamOutlined(webcam, "h")).toBe(false);
    expect(webcamOutlined(webcam, "gone")).toBe(false);
    expect(webcamOutlined(webcam, null)).toBe(false);
  });
});

describe("webcamInspectorTarget", () => {
  const visible = [hidden, custom];

  it("with the layer selected outside any override, edits the global layout", () => {
    expect(webcamInspectorTarget(webcam, visible, WEBCAM_LAYER_SELECTION, 1)).toEqual({
      kind: "layer",
    });
    // A hidden range is not a look to edit: still the global layout.
    expect(webcamInspectorTarget(webcam, visible, WEBCAM_LAYER_SELECTION, 3)).toEqual({
      kind: "layer",
    });
    // Over a slide (no source time) too.
    expect(webcamInspectorTarget(webcam, visible, WEBCAM_LAYER_SELECTION, null)).toEqual({
      kind: "layer",
    });
  });

  it("with the layer selected inside an override, edits that override (what is on screen)", () => {
    expect(webcamInspectorTarget(webcam, visible, WEBCAM_LAYER_SELECTION, 7)).toEqual({
      kind: "segment",
      segment: custom,
    });
  });

  it("an override cut out of the timeline is not a target", () => {
    expect(webcamInspectorTarget(webcam, [hidden], WEBCAM_LAYER_SELECTION, 7)).toEqual({
      kind: "layer",
    });
  });

  it("a selected segment is the target wherever the playhead is", () => {
    expect(webcamInspectorTarget(webcam, visible, "h", 7)).toEqual({
      kind: "segment",
      segment: hidden,
    });
  });

  it("nothing for no selection or a segment that is not visible", () => {
    expect(webcamInspectorTarget(webcam, visible, null, 7)).toBeNull();
    expect(webcamInspectorTarget(webcam, [hidden], "o", 1)).toBeNull();
  });
});

describe("webcamSelectSeekTarget", () => {
  // Source 0-5 sits at timeline 0-5; source 10-20 at timeline 5-15. Source 5-10 is cut out.
  const layout = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
  ]);
  const part: WebcamSegment = {
    id: "p",
    start: 12,
    end: 18,
    mode: "override",
    layout: { size: 0.3 },
    transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
  };

  it("moves the playhead just past a part's slide, so the part's own place shows", () => {
    // Slide 0.7 s + 0.1 s after the start (source 12.8) is timeline 7.8.
    expect(webcamSelectSeekTarget(layout, 0, part)).toBeCloseTo(7.8, 6);
  });

  it("goes only past the start for a Cut", () => {
    const cut = { ...part, transition: { kind: "cut", ms: 700, easing: "back" } } as const;
    expect(webcamSelectSeekTarget(layout, 0, cut)).toBeCloseTo(7.1, 6);
  });

  it("leaves the playhead alone when it is already inside the part past the slide", () => {
    expect(webcamSelectSeekTarget(layout, 10, part)).toBeNull();
  });

  it("moves it when the playhead is inside the part but still on the slide", () => {
    expect(webcamSelectSeekTarget(layout, 7.2, part)).toBeCloseTo(7.8, 6);
  });

  it("stays inside a short part: never past its end", () => {
    const short = { ...part, start: 12, end: 12.4 };
    const target = webcamSelectSeekTarget(layout, 0, short)!;
    expect(target).toBeLessThan(7.4);
    expect(target).toBeGreaterThan(7);
  });

  it("falls back to the stretch that is left when the moment past the slide is cut out", () => {
    // The part starts at source 4.9: 4.9 + slide + 0.1 = 5.7 is in the cut-out gap.
    const cutOut = { ...part, start: 4.9, end: 12 };
    const target = webcamSelectSeekTarget(layout, 10, cutOut);
    expect(target).not.toBeNull();
    // Whatever it picks must be a real timeline time inside the layout.
    expect(target!).toBeGreaterThanOrEqual(0);
    expect(target!).toBeLessThanOrEqual(15);
  });

  it("moves into a hidden range like the zoom lane does", () => {
    expect(
      webcamSelectSeekTarget(layout, 0, { id: "h", start: 12, end: 18, mode: "hidden" }),
    ).not.toBeNull();
  });

  it("is null for a stretch cut away entirely", () => {
    expect(webcamSelectSeekTarget(layout, 0, { ...part, start: 6, end: 9 })).toBeNull();
  });
});
