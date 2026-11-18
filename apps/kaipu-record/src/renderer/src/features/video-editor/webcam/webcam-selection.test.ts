import { describe, expect, it } from "vitest";
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import { WEBCAM_DEFAULTS, type WebcamScene, type WebcamSegment } from "./webcam-model";
import { toLayout } from "../timeline";
import {
  webcamInspectorTarget,
  webcamOutlined,
  webcamPlaySlideTarget,
  webcamSelectSeekTarget,
} from "./webcam-selection";

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

  it("goes to the first footage of the part that survives when the moment past the slide is cut out", () => {
    // The part is source 4.9-12: 4.9 + slide + 0.1 = 5.7 is in the cut-out gap, but source 10-12
    // survives (timeline 5-7) and shows the bubble settled, so the playhead goes to its start.
    const cutOut = { ...part, start: 4.9, end: 12 };
    expect(webcamSelectSeekTarget(layout, 10, cutOut)).toBeCloseTo(5, 6);
    // From inside the slide too: the old rule did nothing there or picked the middle of 4.9-5.
    expect(webcamSelectSeekTarget(layout, 4.95, cutOut)).toBeCloseTo(5, 6);
  });

  it("falls back to the stretch that is left when nothing past the slide survives", () => {
    // The part is source 4.9-5.5 and only 4.9-5 is on the timeline: its middle is 4.95.
    const short = { ...part, start: 4.9, end: 5.5 };
    expect(webcamSelectSeekTarget(layout, 10, short)).toBeCloseTo(4.95, 6);
  });

  it("moves into a hidden range like the zoom lane does: to the middle of its first piece", () => {
    // Source 12-18 is timeline 7-13.
    expect(
      webcamSelectSeekTarget(layout, 0, { id: "h", start: 12, end: 18, mode: "hidden" }),
    ).toBeCloseTo(10, 6);
  });

  it("is null for a stretch cut away entirely", () => {
    expect(webcamSelectSeekTarget(layout, 0, { ...part, start: 6, end: 9 })).toBeNull();
  });
});

describe("webcamPlaySlideTarget", () => {
  // Source 0-5 sits at timeline 0-5; source 10-20 at timeline 5-15. Source 5-10 is cut out.
  const layout = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
  ]);
  const part = (start: number): WebcamSegment => ({
    id: "p",
    start,
    end: start + 4,
    mode: "override",
    transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
  });

  it("starts half a second before the part, so the slide plays from the old place", () => {
    // Source 14 - 0.5 = 13.5 is timeline 8.5.
    expect(webcamPlaySlideTarget(layout, part(14))).toBeCloseTo(8.5, 6);
  });

  it("never goes before the start of the recording", () => {
    expect(webcamPlaySlideTarget(layout, part(0.2))).toBe(0);
  });

  it("starts at the part itself when the moment before it was cut out", () => {
    // Source 10.2 - 0.5 = 9.7 is in the cut-out gap: the part's own start is timeline 5.2.
    expect(webcamPlaySlideTarget(layout, part(10.2))).toBeCloseTo(5.2, 6);
  });

  it("is null when neither moment is on the timeline", () => {
    expect(webcamPlaySlideTarget(layout, { ...part(6), end: 9 })).toBeNull();
  });

  it("starts at the part when reordered clips put the lead after the part on the timeline", () => {
    // Illustrative layout: source 13.8-20 first (timeline 0-6.2), then source 13-13.8 (timeline
    // 6.2-7.0). The part at source 14 sits at timeline 14 - 13.8 = 0.2. Its lead, source 13.5,
    // maps into the second clip: 6.2 + (13.5 - 13) = 6.7, after the part, so playing from there
    // would run to the end and never show the slide. The part's own start, 0.2, is used.
    const reordered = toLayout([
      { id: "a", kind: "clip", sourceStart: 13.8, sourceEnd: 20 },
      { id: "b", kind: "clip", sourceStart: 13, sourceEnd: 13.8 },
    ]);
    expect(webcamPlaySlideTarget(reordered, part(14))).toBeCloseTo(0.2, 6);
  });
});
