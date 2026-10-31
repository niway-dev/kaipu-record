import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_FRAMING,
  cameraBubbleBox,
  cameraCaptureLines,
  cameraCornerRadiusPx,
  clampCameraCornerRadius,
  framingTransform,
  cameraBubbleWindowInArea,
  cameraBubblePresetFor,
  clampCameraBubbleSize,
  sanitizeCameraBubble,
  stepCameraBubbleSize,
} from "./camera-bubble";

describe("clampCameraBubbleSize", () => {
  it("holds the size in 120–480 and rounds it", () => {
    expect(clampCameraBubbleSize(10)).toBe(120);
    expect(clampCameraBubbleSize(1000)).toBe(480);
    expect(clampCameraBubbleSize(300.6)).toBe(301);
    expect(clampCameraBubbleSize(Number.NaN)).toBe(240);
  });
});

describe("cameraBubblePresetFor", () => {
  it("names the S · M · L sizes and nothing else", () => {
    expect(cameraBubblePresetFor(160)).toBe("S");
    expect(cameraBubblePresetFor(240)).toBe("M");
    expect(cameraBubblePresetFor(360)).toBe("L");
    expect(cameraBubblePresetFor(300)).toBeNull();
  });
});

describe("stepCameraBubbleSize", () => {
  it("moves 10 px, or 40 px with Shift", () => {
    expect(stepCameraBubbleSize(300, 1, false)).toBe(310);
    expect(stepCameraBubbleSize(300, -1, true)).toBe(260);
  });

  it("stops on a preset a large step would jump over", () => {
    expect(stepCameraBubbleSize(130, 1, true)).toBe(160);
    expect(stepCameraBubbleSize(380, -1, true)).toBe(360);
    expect(stepCameraBubbleSize(160, 1, true)).toBe(200);
  });

  it("stays inside the range", () => {
    expect(stepCameraBubbleSize(475, 1, true)).toBe(480);
    expect(stepCameraBubbleSize(120, -1, false)).toBe(120);
  });
});

describe("sanitizeCameraBubble", () => {
  it("mirrors by default, and keeps a stored boolean", () => {
    expect(sanitizeCameraBubble({}).mirrored).toBe(true);
    expect(sanitizeCameraBubble({ mirrored: false }).mirrored).toBe(false);
    expect(sanitizeCameraBubble({ mirrored: true }).mirrored).toBe(true);
  });

  it("falls back to mirrored for a stored non-boolean, leaving the other fields alone", () => {
    const result = sanitizeCameraBubble({ shape: "rounded", mirrored: "no" });
    expect(result.mirrored).toBe(true);
    expect(result.shape).toBe("rounded");
  });

  it("drops an empty device id", () => {
    expect(sanitizeCameraBubble({ deviceId: "" }).deviceId).toBeNull();
  });
});

describe("cameraBubbleWindowInArea (main's bubble window and the overlay placeholder)", () => {
  const area = { x: 100, y: 200, width: 640, height: 360 };

  it("anchors the window 32 DIP in from the bottom-left corner, the bubble padded inside it", () => {
    // 240 + 2 × 24 pad = 288, sitting 32 DIP from the left and bottom edges.
    expect(cameraBubbleWindowInArea(area, 240)).toEqual({
      x: 132,
      y: 240,
      width: 288,
      height: 288,
    });
  });

  it("shrinks a size the area cannot hold, and gives up below the minimum", () => {
    // 360 - 2 × 32 - 2 × 24 = 248 is all the area holds.
    expect(cameraBubbleWindowInArea(area, 480)?.width).toBe(248 + 48);
    expect(cameraBubbleWindowInArea({ x: 0, y: 0, width: 231, height: 231 }, 240)).toBeNull();
    expect(cameraBubbleWindowInArea({ x: 0, y: 0, width: 232, height: 232 }, 240)?.width).toBe(
      120 + 48,
    );
  });
});

describe("sanitizeCameraBubble — framing", () => {
  it("defaults to off, centered, no zoom", () => {
    expect(sanitizeCameraBubble({}).framing).toEqual({ enabled: false, zoom: 1, x: 0, y: 0 });
    expect(sanitizeCameraBubble({ framing: "wide" }).framing).toEqual(DEFAULT_CAMERA_FRAMING);
  });

  it("keeps a valid value", () => {
    const framing = { enabled: true, zoom: 1.5, x: 0.4, y: -0.2 };
    expect(sanitizeCameraBubble({ framing }).framing).toEqual(framing);
  });

  it("clamps zoom to 1–3 and the position to -1–1", () => {
    expect(
      sanitizeCameraBubble({ framing: { enabled: true, zoom: 9, x: -5, y: 5 } }).framing,
    ).toEqual({ enabled: true, zoom: 3, x: -1, y: 1 });
    expect(sanitizeCameraBubble({ framing: { zoom: 0.2 } }).framing.zoom).toBe(1);
  });

  it("snaps zoom to the 0.05 step", () => {
    expect(sanitizeCameraBubble({ framing: { zoom: 1.52 } }).framing.zoom).toBe(1.5);
    expect(sanitizeCameraBubble({ framing: { zoom: 1.53 } }).framing.zoom).toBe(1.55);
  });

  it("falls back field by field for non-numbers and non-booleans", () => {
    expect(
      sanitizeCameraBubble({ framing: { enabled: "yes", zoom: "2", x: Number.NaN, y: 0.5 } })
        .framing,
    ).toEqual({ enabled: false, zoom: 1, x: 0, y: 0.5 });
    expect(sanitizeCameraBubble({ framing: { zoom: Infinity, x: null } }).framing).toEqual(
      DEFAULT_CAMERA_FRAMING,
    );
  });
});

describe("framingTransform", () => {
  it("is the identity at zoom 1, whatever the position", () => {
    expect(framingTransform({ zoom: 1, x: 1, y: -1 }, false)).toBe("scale(1) translate(0%, 0%)");
  });

  it("pans at most (z-1)/(2z) of the size, so the image still covers the bubble", () => {
    // zoom 2: the image is twice the bubble, 25 % of the (unscaled) side is the whole slack.
    expect(framingTransform({ zoom: 2, x: 1, y: 1 }, false)).toBe("scale(2) translate(-25%, -25%)");
    expect(framingTransform({ zoom: 2, x: -1, y: -1 }, false)).toBe("scale(2) translate(25%, 25%)");
    expect(framingTransform({ zoom: 3, x: 0.5, y: 0 }, false)).toBe(
      "scale(3) translate(-16.667%, 0%)",
    );
  });

  it("clamps a position outside -1..1 instead of leaving an empty edge", () => {
    expect(framingTransform({ zoom: 2, x: 7, y: -7 }, false)).toBe("scale(2) translate(-25%, 25%)");
  });

  it("moves the view the same way on screen mirrored or not: the flip is applied first", () => {
    const plain = framingTransform({ zoom: 2, x: 1, y: 0 }, false);
    const flipped = framingTransform({ zoom: 2, x: 1, y: 0 }, true);
    expect(flipped).toBe(`${plain} scaleX(-1)`);
    expect(flipped.indexOf("translate")).toBeLessThan(flipped.indexOf("scaleX"));
  });
});

describe("cameraCaptureLines", () => {
  it("keeps today's 480 lines when framing is off, whatever the zoom", () => {
    expect(cameraCaptureLines(480, { enabled: false, zoom: 3, x: 0, y: 0 })).toBe(480);
  });

  it("asks for size × 2 (Retina) × zoom lines, rounded up to 480, 720 or 1080", () => {
    const on = (zoom: number) => ({ enabled: true, zoom, x: 0, y: 0 });
    expect(cameraCaptureLines(240, on(1))).toBe(480);
    expect(cameraCaptureLines(240, on(1.5))).toBe(720);
    expect(cameraCaptureLines(240, on(1.55))).toBe(1080);
    expect(cameraCaptureLines(120, on(1))).toBe(480);
  });

  it("never asks for more than 1080 lines", () => {
    expect(cameraCaptureLines(480, { enabled: true, zoom: 3, x: 0, y: 0 })).toBe(1080);
  });
});

describe("camera shapes and corners (ADR 0041)", () => {
  it("keeps the circle and the square as wide as tall, the rectangle 3:4 portrait", () => {
    expect(cameraBubbleBox("circle", 240)).toEqual({ width: 240, height: 240 });
    expect(cameraBubbleBox("rounded", 240)).toEqual({ width: 240, height: 240 });
    expect(cameraBubbleBox("rectangle", 240)).toEqual({ width: 180, height: 240 });
  });

  it("holds the corner in 0–50 %, snapped to whole percents", () => {
    expect(clampCameraCornerRadius(-1)).toBe(0);
    expect(clampCameraCornerRadius(0.9)).toBe(0.5);
    expect(clampCameraCornerRadius(0.234)).toBe(0.23);
    expect(clampCameraCornerRadius(Number.NaN)).toBe(0.18);
  });

  it("measures the corner on the shorter side; the circle is always half of it", () => {
    expect(cameraCornerRadiusPx("rounded", 0.25, 200, 200)).toBe(50);
    expect(cameraCornerRadiusPx("rectangle", 0.5, 180, 240)).toBe(90);
    expect(cameraCornerRadiusPx("circle", 0, 200, 200)).toBe(100);
  });

  it("reads settings saved before the slider as today's 18 % rounded square", () => {
    const old = { shape: "rounded", size: 240, deviceId: null, mirrored: true };
    expect(sanitizeCameraBubble(old)).toMatchObject({ shape: "rounded", cornerRadius: 0.18 });
    expect(sanitizeCameraBubble({ shape: "rectangle", cornerRadius: 0.4 })).toMatchObject({
      shape: "rectangle",
      cornerRadius: 0.4,
    });
    expect(sanitizeCameraBubble({ cornerRadius: "big" }).cornerRadius).toBe(0.18);
  });
});
