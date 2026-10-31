import { describe, expect, it } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamLayout } from "./webcam-model";
import {
  WEBCAM_POSITION_PRESETS,
  WEBCAM_PRESET_MARGIN,
  clampWebcamCenter,
  webcamClipPath,
  webcamPresetCenter,
  webcamRect,
  webcamSourceRect,
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
    expect(rect).toEqual({ x: 960 - 108, y: 540 - 108, width: 216, height: 216 });
  });

  it("keeps the whole bubble inside the frame when the centre is at a corner", () => {
    const rect = webcamRect(layout({ size: 0.2, position: { x: 0, y: 1 } }), FRAME)!;
    expect(rect.x).toBe(0);
    expect(rect.y + rect.height).toBe(1080);
  });

  it("shrinks during a zoom by the camera path's scale, around the same centre", () => {
    const flat = webcamRect(layout({ size: 0.2, position: { x: 0.5, y: 0.5 } }), FRAME, 1)!;
    const zoomed = webcamRect(
      layout({ size: 0.2, position: { x: 0.5, y: 0.5 }, scaleDuringZoom: 0.5 }),
      FRAME,
      2,
    )!;
    expect(zoomed.height).toBeCloseTo(flat.height * 0.5);
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(flat.x + flat.width / 2);
  });

  it("is in the frame's own units: a 1×1 frame gives fractions", () => {
    const rect = webcamRect(layout({ size: 0.5, position: { x: 0.5, y: 0.5 } }), {
      width: 1,
      height: 1,
    });
    expect(rect).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("draws the rectangle 3:4 portrait: size is its height, the width follows", () => {
    const rect = webcamRect(
      layout({ shape: "rectangle", size: 0.4, position: { x: 0.5, y: 0.5 } }),
      FRAME,
    );
    expect(rect).toEqual({ x: 960 - 162, y: 540 - 216, width: 324, height: 432 });
  });

  it("keeps the rectangle's aspect when a narrow frame caps its width", () => {
    const rect = webcamRect(
      layout({ shape: "rectangle", size: 0.6, position: { x: 0.5, y: 0.5 } }),
      { width: 300, height: 1000 },
    )!;
    expect(rect.width).toBeCloseTo(300);
    expect(rect.height).toBeCloseTo(400);
  });

  it("is null for a frame whose size is not known yet", () => {
    expect(webcamRect(WEBCAM_DEFAULTS, { width: 0, height: 0 })).toBeNull();
  });
});

describe("clampWebcamCenter", () => {
  it("leaves a centre that already fits alone", () => {
    expect(clampWebcamCenter({ x: 0.5, y: 0.4 }, { width: 100, height: 100 }, FRAME)).toEqual({
      x: 0.5,
      y: 0.4,
    });
  });

  it("centres a bubble wider than a narrow frame", () => {
    const box = { width: 400, height: 400 };
    expect(clampWebcamCenter({ x: 0.1, y: 0.5 }, box, { width: 300, height: 1000 }).x).toBe(0.5);
  });

  it("clamps each axis by the box's own side", () => {
    const c = clampWebcamCenter({ x: 0, y: 0 }, { width: 300, height: 400 }, FRAME);
    expect(c.x * 1920).toBeCloseTo(150);
    expect(c.y * 1080).toBeCloseTo(200);
  });
});

describe("webcamClipPath", () => {
  it("cuts a circle, or a square with the corner a share of its side", () => {
    expect(webcamClipPath("circle", 0.3)).toBe("circle(50% at 50% 50%)");
    expect(webcamClipPath("rounded", 0.18)).toBe("inset(0 round 18% / 18%)");
    expect(webcamClipPath("rounded", 0)).toBe("inset(0 round 0% / 0%)");
  });

  it("keeps the rectangle's corners circular: the vertical radius is scaled by 3/4", () => {
    // r = 0.2 × width; as a share of the height that is 0.2 × 3/4 = 15 %.
    expect(webcamClipPath("rectangle", 0.2)).toBe("inset(0 round 20% / 15%)");
    expect(webcamClipPath("rectangle", 0.5)).toBe("inset(0 round 50% / 37.5%)");
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
      expect(clampWebcamCenter(c, { width: 0.3 * 1080, height: 0.3 * 1080 }, FRAME)).toEqual(c);
    }
  });

  it("puts a rectangle snug by its own width", () => {
    const c = webcamPresetCenter({ x: 0, y: 1 }, 0.4, FRAME, "rectangle");
    expect(c.x * 1920).toBeCloseTo(162 + WEBCAM_PRESET_MARGIN * 1080);
    expect(c.y * 1080).toBeCloseTo(1080 - 216 - WEBCAM_PRESET_MARGIN * 1080);
  });

  it("sizes the bubble with webcamRect's caps, so a capped bubble keeps its edge margin", () => {
    // 0.6 of a 1920 px height is 1152 px, wider than the 1080 px frame: capped to 1080.
    const portrait = { width: 1080, height: 1920 };
    const c = webcamPresetCenter({ x: 0, y: 1 }, 0.6, portrait);
    expect(c.y * 1920).toBeCloseTo(1920 - 540 - WEBCAM_PRESET_MARGIN * 1920);
  });

  it("falls back to the raw preset before the frame size is known", () => {
    expect(webcamPresetCenter({ x: 1, y: 0 }, 0.2, { width: 0, height: 0 })).toEqual({
      x: 1,
      y: 0,
    });
  });
});

describe("webcamSourceRect", () => {
  const IMAGE = { width: 1280, height: 720 };

  it("shows the centred square cover puts in the bubble without framing", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false)).toEqual({
      sx: 280,
      sy: 0,
      sw: 720,
      sh: 720,
    });
  });

  it("ignores the pan at zoom 1, where there is nothing to pan", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 1, x: 1, y: -1 }, true)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false),
    );
  });

  it("narrows to 1/zoom of the square, centred", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 2, x: 0, y: 0 }, false)).toEqual({
      sx: 460,
      sy: 180,
      sw: 360,
      sh: 360,
    });
  });

  it("pans to the square's edge at x = 1 and y = 1, never past it", () => {
    // zoom 2: the window is 360 px, its centre moves 180 px: right/bottom edge of the square.
    const r = webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: 1 }, false);
    expect(r.sx + r.sw).toBe(1000); // 280 + 720, the cover square's right edge
    expect(r.sy + r.sh).toBe(720);
    expect(webcamSourceRect(IMAGE, { zoom: 2, x: 3, y: -3 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: -1 }, false),
    );
  });

  it("moves the other way in the raw image when mirrored: x = 1 shows the bubble's right", () => {
    // Mirrored, the right of what the bubble shows is the LEFT of the raw image.
    const r = webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: 0 }, true);
    expect(r.sx).toBe(280);
  });

  it("clamps the framing exactly like the preview's framingTransform", () => {
    // Past the 3× cap, and between zoom steps: the preview shows 3× and 1.25×.
    expect(webcamSourceRect(IMAGE, { zoom: 9, x: 0, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 3, x: 0, y: 0 }, false),
    );
    expect(webcamSourceRect(IMAGE, { zoom: 1.26, x: 0, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 1.25, x: 0, y: 0 }, false),
    );
    // Pans round to two decimals; a non-number falls back like the preview's does.
    expect(webcamSourceRect(IMAGE, { zoom: 2, x: 0.504, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 2, x: 0.5, y: 0 }, false),
    );
    expect(webcamSourceRect(IMAGE, { zoom: Number.NaN, x: Number.NaN, y: 0 }, false)).toEqual(
      webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false),
    );
  });

  it("works for a portrait image (cover picks the width)", () => {
    expect(webcamSourceRect({ width: 720, height: 1280 }, { zoom: 1, x: 0, y: 0 }, false)).toEqual({
      sx: 0,
      sy: 280,
      sw: 720,
      sh: 720,
    });
  });

  it("covers a 3:4 box from a 16:9 image: full height, 3/4 of it wide, centred", () => {
    expect(webcamSourceRect(IMAGE, { zoom: 1, x: 0, y: 0 }, false, 3 / 4)).toEqual({
      sx: 370,
      sy: 0,
      sw: 540,
      sh: 720,
    });
  });

  it("pans a 3:4 window to the cover's edge on each axis by its own length", () => {
    const r = webcamSourceRect(IMAGE, { zoom: 2, x: 1, y: 1 }, false, 3 / 4);
    expect(r.sw).toBe(270);
    expect(r.sh).toBe(360);
    expect(r.sx + r.sw).toBe(910); // 370 + 540, the cover window's right edge
    expect(r.sy + r.sh).toBe(720);
  });
});

describe("webcamRect on a portrait output", () => {
  it("never makes the bubble wider than the frame (0.6 of a 1920 px height on 1080 px)", () => {
    const rect = webcamRect(layout({ size: 0.6, position: { x: 1, y: 1 } }), {
      width: 1080,
      height: 1920,
    })!;
    expect(rect.width).toBe(1080);
    expect(rect.x).toBe(0);
    expect(rect.y + rect.height).toBe(1920);
  });
});
