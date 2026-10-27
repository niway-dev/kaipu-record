import { describe, expect, it } from "vitest";
import { controlBarBounds } from "./control-bar-placement";

// A 1512 × 982 MacBook display whose work area starts under a 33 DIP menu bar.
const WORK = { x: 0, y: 33, width: 1512, height: 949 };
const BAR = { width: 480, height: 82 };

describe("controlBarBounds", () => {
  it("stays at the bottom centre for a whole display", () => {
    expect(controlBarBounds(WORK, BAR, null)).toEqual({
      x: 516,
      y: 33 + 949 - 82 - 40,
      width: 480,
      height: 82,
    });
  });

  it("sits centred 16 DIP under an area when it fits there", () => {
    const area = { x: 100, y: 100, width: 640, height: 360 };
    expect(controlBarBounds(WORK, BAR, area)).toEqual({ x: 180, y: 476, width: 480, height: 82 });
  });

  it("moves to the right of an area that reaches the bottom, top-aligned", () => {
    const area = { x: 100, y: 200, width: 640, height: 760 };
    expect(controlBarBounds(WORK, BAR, area)).toEqual({ x: 756, y: 200, width: 480, height: 82 });
  });

  it("moves to the left when the right has no room either", () => {
    const area = { x: 900, y: 200, width: 600, height: 760 };
    expect(controlBarBounds(WORK, BAR, area)).toEqual({ x: 404, y: 200, width: 480, height: 82 });
  });

  it("falls back to the bottom centre for an area that fills the display", () => {
    const area = { x: 0, y: 33, width: 1512, height: 949 };
    expect(controlBarBounds(WORK, BAR, area)).toEqual(controlBarBounds(WORK, BAR, null));
  });

  it("is clamped to the work area for an area at a display's edge", () => {
    const area = { x: 1300, y: 100, width: 200, height: 200 };
    const bounds = controlBarBounds(WORK, BAR, area);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1512);
    expect(bounds.y).toBe(316);
  });

  it("works on a display left of the primary (negative origin)", () => {
    const work = { x: -1920, y: 0, width: 1920, height: 1040 };
    const area = { x: -1800, y: 100, width: 640, height: 360 };
    expect(controlBarBounds(work, BAR, area)).toEqual({ x: -1720, y: 476, width: 480, height: 82 });
  });
});
