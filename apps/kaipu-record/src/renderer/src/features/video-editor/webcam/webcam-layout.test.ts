import { describe, expect, it } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamLayout } from "./webcam-model";
import {
  WEBCAM_POSITION_PRESETS,
  WEBCAM_PRESET_MARGIN,
  clampWebcamCenter,
  webcamClipPath,
  webcamPresetCenter,
  webcamRect,
  webcamZoomFactor,
} from "./webcam-layout";

const FRAME = { width: 1920, height: 1080 };
const layout = (patch: Partial<WebcamLayout>): WebcamLayout => ({ ...WEBCAM_DEFAULTS, ...patch });

describe("webcamZoomFactor", () => {
  it("is 1 without a zoom, whatever scaleDuringZoom says", () => {
    expect(webcamZoomFactor(0.7, 1)).toBe(1);
  });

  it("reaches scaleDuringZoom at 1.5× and stays there", () => {
    expect(webcamZoomFactor(0.7, 1.5)).toBeCloseTo(0.7);
    expect(webcamZoomFactor(0.7, 3)).toBeCloseTo(0.7);
  });

  it("eases in between, so the bubble follows the camera's spring", () => {
    expect(webcamZoomFactor(0.7, 1.25)).toBeCloseTo(0.85);
  });

  it("never shrinks when the toggle is off (scaleDuringZoom 1)", () => {
    expect(webcamZoomFactor(1, 2.5)).toBe(1);
  });

  it("treats a non-finite camera scale as no zoom", () => {
    expect(webcamZoomFactor(0.7, Number.NaN)).toBe(1);
  });
});

describe("webcamRect", () => {
  it("sizes the bubble as a fraction of the OUTPUT height and centres it on the position", () => {
    const rect = webcamRect(layout({ size: 0.2, position: { x: 0.5, y: 0.5 } }), FRAME);
    expect(rect).toEqual({ x: 960 - 108, y: 540 - 108, size: 216 });
  });

  it("keeps the whole bubble inside the frame when the centre is at a corner", () => {
    const rect = webcamRect(layout({ size: 0.2, position: { x: 0, y: 1 } }), FRAME)!;
    expect(rect.x).toBe(0);
    expect(rect.y + rect.size).toBe(1080);
  });

  it("shrinks during a zoom by the camera path's scale, around the same centre", () => {
    const flat = webcamRect(layout({ size: 0.2, position: { x: 0.5, y: 0.5 } }), FRAME, 1)!;
    const zoomed = webcamRect(
      layout({ size: 0.2, position: { x: 0.5, y: 0.5 }, scaleDuringZoom: 0.5 }),
      FRAME,
      2,
    )!;
    expect(zoomed.size).toBeCloseTo(flat.size * 0.5);
    expect(zoomed.x + zoomed.size / 2).toBeCloseTo(flat.x + flat.size / 2);
  });

  it("is in the frame's own units: a 1×1 frame gives fractions", () => {
    const rect = webcamRect(layout({ size: 0.5, position: { x: 0.5, y: 0.5 } }), {
      width: 1,
      height: 1,
    });
    expect(rect).toEqual({ x: 0.25, y: 0.25, size: 0.5 });
  });

  it("is null for a frame whose size is not known yet", () => {
    expect(webcamRect(WEBCAM_DEFAULTS, { width: 0, height: 0 })).toBeNull();
  });
});

describe("clampWebcamCenter", () => {
  it("leaves a centre that already fits alone", () => {
    expect(clampWebcamCenter({ x: 0.5, y: 0.4 }, 100, FRAME)).toEqual({ x: 0.5, y: 0.4 });
  });

  it("centres a bubble wider than a narrow frame", () => {
    expect(clampWebcamCenter({ x: 0.1, y: 0.5 }, 400, { width: 300, height: 1000 }).x).toBe(0.5);
  });
});

describe("webcamClipPath", () => {
  it("cuts a circle or a rounded square", () => {
    expect(webcamClipPath("circle")).toBe("circle(50% at 50% 50%)");
    expect(webcamClipPath("rounded")).toBe("inset(0 round 18%)");
  });
});

describe("webcamPresetCenter", () => {
  it("offers nine positions", () => {
    expect(WEBCAM_POSITION_PRESETS).toHaveLength(9);
  });

  it("puts the bottom-left preset snug in the corner with the margin", () => {
    const c = webcamPresetCenter({ x: 0, y: 1 }, 0.2, FRAME);
    const half = 108 + WEBCAM_PRESET_MARGIN * 1080;
    expect(c.x * 1920).toBeCloseTo(half);
    expect(c.y * 1080).toBeCloseTo(1080 - half);
  });

  it("stores what is drawn: the preset centre survives the clamp unchanged", () => {
    for (const preset of WEBCAM_POSITION_PRESETS) {
      const c = webcamPresetCenter(preset, 0.3, FRAME);
      expect(clampWebcamCenter(c, 0.3 * 1080, FRAME)).toEqual(c);
    }
  });

  it("falls back to the raw preset before the frame size is known", () => {
    expect(webcamPresetCenter({ x: 1, y: 0 }, 0.2, { width: 0, height: 0 })).toEqual({
      x: 1,
      y: 0,
    });
  });
});
