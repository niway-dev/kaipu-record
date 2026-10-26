import { describe, expect, it } from "vitest";
import { areaToGlobal, bubbleBoundsInArea } from "./area-geometry";

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
