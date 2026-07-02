import { describe, expect, it } from "vitest";
import { clampCrop, cropHandles, hitCropHandle, isFullCrop, moveCrop, resizeCrop } from "./crop";
import type { CropRect } from "./scene";

const size = { w: 1000, h: 1000 };
const c: CropRect = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

describe("isFullCrop", () => {
  it("is true for the whole image (within epsilon)", () => {
    expect(isFullCrop({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.0005, y: 0, w: 0.9996, h: 1 })).toBe(true);
  });
  it("is false for a real crop", () => {
    expect(isFullCrop(c)).toBe(false);
  });
});

describe("clampCrop", () => {
  it("keeps a valid crop unchanged", () => {
    expect(clampCrop(c)).toEqual(c);
  });
  it("clamps into [0,1] and enforces a min size", () => {
    const out = clampCrop({ x: -0.5, y: 0.9, w: 2, h: 0.0001 });
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBeLessThanOrEqual(1.0001);
    expect(out.h).toBeGreaterThan(0);
  });
});

describe("moveCrop", () => {
  it("translates and clamps so the rect stays inside the canvas", () => {
    const out = moveCrop(c, 0.9, 0); // would push right edge past 1
    expect(out.x + out.w).toBeCloseTo(1);
    expect(out.w).toBeCloseTo(c.w); // size preserved
  });
  it("clamps the near edge at zero", () => {
    const out = moveCrop(c, -0.9, -0.9);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
  });
});

describe("cropHandles / resizeCrop / hitCropHandle (box adapter over handles.ts)", () => {
  it("exposes 8 handles", () => {
    expect(cropHandles(c, size)).toHaveLength(8);
  });
  it("resizes via the se corner and clamps to the canvas", () => {
    const out = resizeCrop(c, "se", { x: 0.9, y: 0.9 }, size);
    expect(out.w).toBeCloseTo(0.7);
    expect(out.h).toBeCloseTo(0.7);
  });
  it("finds the handle under the point", () => {
    // se corner at (0.6, 0.6)
    expect(hitCropHandle(c, { x: 0.605, y: 0.598 }, { x: 0.02, y: 0.02 }, size)).toBe("se");
  });
});
