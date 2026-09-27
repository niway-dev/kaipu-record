import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATERMARK_CONFIG,
  resolveWatermarkEnabled,
  watermarkRect,
  type WatermarkConfig,
} from "./watermark";

const base: WatermarkConfig = {
  ...DEFAULT_WATERMARK_CONFIG,
  heightRatio: 0.1, // 1080 → 108px tall
  marginRatio: 0.05, // 1080 → 54px margin
};

describe("watermarkRect", () => {
  // aspect 2 → width = 2 × height = 216px at 1080p
  it("places the watermark bottom-right by default", () => {
    const r = watermarkRect(1920, 1080, 2, { ...base, position: "bottom-right" });
    expect(r).toEqual({ x: 1920 - 216 - 54, y: 1080 - 108 - 54, width: 216, height: 108 });
  });

  it("honours each corner + center", () => {
    expect(watermarkRect(1920, 1080, 2, { ...base, position: "top-left" })).toMatchObject({
      x: 54,
      y: 54,
    });
    expect(watermarkRect(1920, 1080, 2, { ...base, position: "bottom-left" })).toMatchObject({
      x: 54,
      y: 1080 - 108 - 54,
    });
    expect(watermarkRect(1920, 1080, 2, { ...base, position: "bottom-center" })).toMatchObject({
      x: Math.round((1920 - 216) / 2),
    });
    expect(watermarkRect(1920, 1080, 2, { ...base, position: "middle-right" })).toMatchObject({
      x: 1920 - 216 - 54, // right edge
      y: Math.round((1080 - 108) / 2), // vertically centered
    });
  });

  it("scales with the frame height (same relative size at 4K)", () => {
    const r = watermarkRect(3840, 2160, 2, base);
    expect(r.height).toBe(216); // 2160 × 0.1
    expect(r.width).toBe(432);
  });
});

describe("resolveWatermarkEnabled", () => {
  it("shows the watermark for free users with the flag on", () => {
    expect(resolveWatermarkEnabled({ flagOn: true, isPaid: false, devForce: null })).toBe(true);
  });

  it("removes it for paid users", () => {
    expect(resolveWatermarkEnabled({ flagOn: true, isPaid: true, devForce: null })).toBe(false);
  });

  it("the flag can kill it entirely", () => {
    expect(resolveWatermarkEnabled({ flagOn: false, isPaid: false, devForce: null })).toBe(false);
  });

  it("the dev force overrides the real entitlement", () => {
    // forced paid → off, even though the real entitlement is free
    expect(resolveWatermarkEnabled({ flagOn: true, isPaid: false, devForce: "paid" })).toBe(false);
    // forced free → on, even though the real entitlement is paid
    expect(resolveWatermarkEnabled({ flagOn: true, isPaid: true, devForce: "free" })).toBe(true);
  });
});

describe("DEFAULT_WATERMARK_CONFIG", () => {
  // The mark is a signature, not a claim on the frame: it sits in a corner and
  // stays under the content. Moved off `middle-right`, which overlapped the video.
  it("is faint enough not to compete with the content", () => {
    expect(DEFAULT_WATERMARK_CONFIG.opacity).toBeLessThanOrEqual(0.75);
  });

  it("sits in the frame's bottom-right corner at 1080p", () => {
    const aspect = 1974 / 352; // the shipped wordmark asset
    const r = watermarkRect(1920, 1080, aspect, DEFAULT_WATERMARK_CONFIG);
    const margin = Math.round(1080 * DEFAULT_WATERMARK_CONFIG.marginRatio);
    expect(r.x).toBe(1920 - r.width - margin);
    expect(r.y).toBe(1080 - r.height - margin);
  });

  // The first build of this change used a 2.5 % margin and the mark read as stuck
  // to the bottom edge, overlapping the recorded content's own bottom bar. The
  // gap below the mark must stay comparable to the mark's own height.
  it("keeps the mark clear of the bottom edge, not glued to it", () => {
    const r = watermarkRect(1920, 1080, 1974 / 352, DEFAULT_WATERMARK_CONFIG);
    const gapBelow = 1080 - (r.y + r.height);
    expect(gapBelow).toBeGreaterThanOrEqual(r.height * 0.75);
  });
});
