import { describe, expect, it } from "vitest";
import {
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
