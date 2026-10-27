import { describe, expect, it } from "vitest";
import {
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
