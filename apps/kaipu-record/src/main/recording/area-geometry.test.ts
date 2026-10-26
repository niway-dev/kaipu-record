import { describe, expect, it } from "vitest";
import { areaToGlobal, bubbleBoundsInArea, sanitizeArea } from "./area-geometry";

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
  it("puts the bubble in the area's bottom-left corner with the usual margin", () => {
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 640, height: 360 })).toEqual({
      x: 40,
      y: 96,
      width: 224,
      height: 224,
    });
  });

  it("follows the area on a second display", () => {
    expect(bubbleBoundsInArea({ x: 1612, y: 50, width: 640, height: 360 })).toEqual({
      x: 1652,
      y: 146,
      width: 224,
      height: 224,
    });
  });

  it("answers null when the area cannot hold the bubble and its margins", () => {
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 300, height: 300 })).toBeNull();
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 1280, height: 303 })).toBeNull();
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 304, height: 304 })).not.toBeNull();
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
