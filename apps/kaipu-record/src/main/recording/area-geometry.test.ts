import { describe, expect, it } from "vitest";
import { areaToGlobal, bubbleBoundsInArea, bubbleSizeOf, sanitizeArea } from "./area-geometry";

describe("areaToGlobal", () => {
  it("moves a display-relative area to global DIP", () => {
    expect(
      areaToGlobal(
        {
          displayId: 2,
          rect: { x: 100, y: 50, width: 640, height: 360 },
          displaySize: { width: 2560, height: 1440 },
        },
        { x: 1512, y: -200, width: 2560, height: 1440 },
      ),
    ).toEqual({ x: 1612, y: -150, width: 640, height: 360 });
  });
});

describe("bubbleBoundsInArea", () => {
  // Window = bubble + 2 × 24 px pad, 32 px from the area's left and bottom edges.
  it("anchors the default (M, 240 px) bubble at the area's bottom-left corner", () => {
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 640, height: 360 })).toEqual({
      x: 32,
      y: 40,
      width: 288,
      height: 288,
    });
  });

  it("follows the area on a second display", () => {
    expect(bubbleBoundsInArea({ x: 1612, y: 50, width: 1280, height: 720 }, 160)).toEqual({
      x: 1644,
      y: 530,
      width: 208,
      height: 208,
    });
  });

  it("grows up and to the right from the same corner", () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    const small = bubbleBoundsInArea(area, 160)!;
    const large = bubbleBoundsInArea(area, 360)!;
    expect(large.x).toBe(small.x);
    expect(large.y + large.height).toBe(small.y + small.height);
    expect(bubbleSizeOf(large)).toBe(360);
  });

  it("clamps the size to the allowed range", () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    expect(bubbleSizeOf(bubbleBoundsInArea(area, 40)!)).toBe(120);
    expect(bubbleSizeOf(bubbleBoundsInArea(area, 900)!)).toBe(480);
  });

  it("shrinks a bubble the area cannot hold to what fits", () => {
    // 300 − 2 × 32 − 2 × 24 = 188 px of room.
    expect(bubbleSizeOf(bubbleBoundsInArea({ x: 0, y: 0, width: 300, height: 300 }, 360)!)).toBe(
      188,
    );
  });

  it("answers null when not even the smallest bubble fits", () => {
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 231, height: 600 })).toBeNull();
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 1280, height: 231 })).toBeNull();
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 232, height: 232 })).not.toBeNull();
  });
});

describe("sanitizeArea — an area that crossed a process boundary", () => {
  const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
  const area = (rect: unknown, displayId: unknown = 2) => ({
    displayId,
    rect,
    displaySize: { width: 9999, height: 9999 },
  });

  it("keeps a valid area, rounded, with the display's own size", () => {
    expect(sanitizeArea(area({ x: 100.4, y: 50, width: 640, height: 360.6 }), display)).toEqual({
      displayId: 2,
      rect: { x: 100, y: 50, width: 640, height: 361 },
      displaySize: { width: 1512, height: 982 },
    });
  });

  it("keeps the ratio the area was locked to, and drops one that names no chip", () => {
    const rect = { x: 0, y: 0, width: 640, height: 360 };
    expect(sanitizeArea({ ...area(rect), ratio: "16:9" }, display)?.ratio).toBe("16:9");
    expect(sanitizeArea({ ...area(rect), ratio: "4:3" }, display)).not.toHaveProperty("ratio");
  });

  it("clamps an area that hangs off the display to the part on it", () => {
    expect(
      sanitizeArea(area({ x: -500, y: 900, width: 5000, height: 400 }), display)?.rect,
    ).toEqual({ x: 0, y: 900, width: 1512, height: 82 });
  });

  it("refuses what is malformed, on another display, or under the minimum once clamped", () => {
    expect(sanitizeArea(null, display)).toBeNull();
    expect(sanitizeArea("area", display)).toBeNull();
    expect(sanitizeArea(area({ x: 0, y: 0, width: 640, height: 360 }, 3), display)).toBeNull();
    expect(sanitizeArea(area({ x: 0, y: 0, width: 0, height: 360 }), display)).toBeNull();
    expect(
      sanitizeArea(area({ x: Number.NaN, y: 0, width: 640, height: 360 }), display),
    ).toBeNull();
    expect(sanitizeArea(area({ x: 1500, y: 0, width: 640, height: 360 }), display)).toBeNull();
  });
});
