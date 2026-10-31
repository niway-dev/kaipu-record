import { describe, expect, it } from "vitest";
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import { WEBCAM_DEFAULTS, type WebcamScene, type WebcamSegment } from "./webcam-model";
import { webcamInspectorTarget, webcamOutlined } from "./webcam-selection";

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
