import { describe, expect, it } from "vitest";
import { frameRectToPictureRect, isInsidePicture } from "./letterbox";

const RECT = { x: 0.25, y: 0.2, w: 0.5, h: 0.4 };
const WIDE = 16 / 9;
const FOUR_THREE = 4 / 3;

describe("frameRectToPictureRect", () => {
  it("is the identity when the picture has the frame's aspect", () => {
    expect(frameRectToPictureRect(RECT, WIDE, WIDE)).toBe(RECT);
  });

  it("is the identity for an unknown aspect", () => {
    expect(frameRectToPictureRect(RECT, 0, WIDE)).toBe(RECT);
    expect(frameRectToPictureRect(RECT, WIDE, 0)).toBe(RECT);
  });

  it("maps a rect through the bars of a 4:3 picture in a 16:9 frame", () => {
    // The picture is 0.75 of the frame's width, centred: bars of 0.125 each side.
    const mapped = frameRectToPictureRect(RECT, WIDE, FOUR_THREE);
    expect(mapped.x).toBeCloseTo((0.25 - 0.125) / 0.75, 9);
    expect(mapped.w).toBeCloseTo(0.5 / 0.75, 9);
    expect(mapped.y).toBe(RECT.y);
    expect(mapped.h).toBe(RECT.h);
    expect(isInsidePicture(mapped)).toBe(true);
  });

  it("maps a rect through the bars of a 16:9 picture in a 4:3 frame", () => {
    // The picture is 0.75 of the frame's height, centred: bars of 0.125 above and below.
    const mapped = frameRectToPictureRect(RECT, FOUR_THREE, WIDE);
    expect(mapped.y).toBeCloseTo((0.2 - 0.125) / 0.75, 9);
    expect(mapped.h).toBeCloseTo(0.4 / 0.75, 9);
    expect(mapped.x).toBe(RECT.x);
    expect(mapped.w).toBe(RECT.w);
  });

  it("puts a rect over a bar outside the picture", () => {
    // The left bar of the 4:3 picture is x in [0, 0.125] of the frame.
    const mapped = frameRectToPictureRect({ x: 0.01, y: 0.1, w: 0.1, h: 0.2 }, WIDE, FOUR_THREE);
    expect(mapped.x + mapped.w).toBeLessThan(0);
    expect(isInsidePicture(mapped)).toBe(false);
  });

  it("keeps a rect that straddles a bar partly outside", () => {
    const mapped = frameRectToPictureRect({ x: 0.05, y: 0.1, w: 0.2, h: 0.2 }, WIDE, FOUR_THREE);
    expect(mapped.x).toBeLessThan(0);
    expect(mapped.x + mapped.w).toBeGreaterThan(0);
    expect(isInsidePicture(mapped)).toBe(false);
  });
});

describe("isInsidePicture", () => {
  it("accepts the whole picture and rejects an overhang", () => {
    expect(isInsidePicture({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isInsidePicture({ x: -0.1, y: 0, w: 0.5, h: 1 })).toBe(false);
    expect(isInsidePicture({ x: 0.5, y: 0, w: 0.6, h: 1 })).toBe(false);
  });
});
