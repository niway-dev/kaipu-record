import { describe, expect, it } from "vitest";
import {
  devicePixelSize,
  fitRatio,
  ratioValue,
  resizeWithRatio,
  spanWithRatio,
} from "./ratio-geometry";

// A 1440 × 875 work area starting under a 25 DIP menu bar, like a 1440 × 900 MacBook.
const AREA = { x: 0, y: 25, width: 1440, height: 875 };
const WIDE = 16 / 9;

describe("ratioValue", () => {
  it("is width over height for a locked ratio and null for Free", () => {
    expect(ratioValue("16:9")).toBeCloseTo(WIDE);
    expect(ratioValue("9:16")).toBeCloseTo(9 / 16);
    expect(ratioValue("1:1")).toBe(1);
    expect(ratioValue("free")).toBeNull();
  });
});

describe("fitRatio", () => {
  it("keeps the width and the centre when the ratio fits", () => {
    const box = fitRatio({ x: 100, y: 300, width: 640, height: 200 }, "16:9", AREA);
    expect(box).toEqual({ x: 100, y: 220, width: 640, height: 360 });
    expect(box.y + box.height / 2).toBe(400);
  });

  it("shrinks a box whose ratio would leave the work area, and keeps it inside", () => {
    const box = fitRatio({ x: 0, y: 25, width: 1440, height: 875 }, "9:16", AREA);
    expect(box.height).toBe(875);
    expect(box.width).toBe(Math.round(875 * (9 / 16)));
    expect(box.y).toBe(25);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
  });

  it("grows a box under the recording minimum to the minimum on both sides", () => {
    const box = fitRatio({ x: 500, y: 500, width: 20, height: 20 }, "9:16", AREA);
    expect(box.width).toBe(64);
    expect(box.height).toBe(Math.round(64 * (16 / 9)));
  });

  it("returns the box unchanged for Free", () => {
    const rect = { x: 3, y: 40, width: 333, height: 111 };
    expect(fitRatio(rect, "free", AREA)).toBe(rect);
  });
});

describe("spanWithRatio", () => {
  it("follows the axis the pointer pulls further and keeps the anchor still", () => {
    const box = spanWithRatio({ x: 100, y: 100 }, { x: 740, y: 150 }, WIDE, AREA);
    expect(box).toEqual({ x: 100, y: 100, width: 640, height: 360 });
    const tall = spanWithRatio({ x: 100, y: 100 }, { x: 110, y: 460 }, WIDE, AREA);
    expect(tall).toEqual({ x: 100, y: 100, width: 640, height: 360 });
  });

  it("spans up and to the left from the anchor", () => {
    const box = spanWithRatio({ x: 800, y: 500 }, { x: 160, y: 480 }, WIDE, AREA);
    expect(box).toEqual({ x: 160, y: 140, width: 640, height: 360 });
  });

  it("is capped by the room between the anchor and the work area's edge", () => {
    const box = spanWithRatio({ x: 1200, y: 100 }, { x: 2000, y: 2000 }, 1, AREA);
    expect(box).toEqual({ x: 1200, y: 100, width: 240, height: 240 });
  });
});

describe("resizeWithRatio", () => {
  const start = { x: 100, y: 100, width: 640, height: 360 };

  it("keeps the opposite corner still when a corner is dragged", () => {
    const box = resizeWithRatio(start, "se", { x: 1060, y: 300 }, WIDE, AREA);
    expect(box).toEqual({ x: 100, y: 100, width: 960, height: 540 });
    const nw = resizeWithRatio(start, "nw", { x: 420, y: 0 }, WIDE, AREA);
    expect(nw.x + nw.width).toBe(740);
    expect(nw.y + nw.height).toBe(460);
    expect(nw.width / nw.height).toBeCloseTo(WIDE, 1);
  });

  it("grows around the centre line when an edge is dragged", () => {
    const low = { ...start, y: 300 };
    const box = resizeWithRatio(low, "e", { x: 1060, y: 999 }, WIDE, AREA);
    expect(box.x).toBe(100);
    expect(box.width).toBe(960);
    expect(box.height).toBe(540);
    expect(box.y + box.height / 2).toBe(480);
    const north = resizeWithRatio(low, "n", { x: 0, y: 480 }, WIDE, AREA);
    expect(north.y + north.height).toBe(660);
    expect(north.height).toBe(180);
    expect(north.width).toBe(320);
  });

  it("never goes under the minimum, even when the pointer crosses the fixed edge", () => {
    const box = resizeWithRatio(start, "e", { x: 0, y: 0 }, 1, AREA);
    expect(box).toMatchObject({ x: 100, width: 64, height: 64 });
  });
});

describe("devicePixelSize", () => {
  it("multiplies DIP by the scale factor, falling back to 1 for a bad scale", () => {
    expect(devicePixelSize({ width: 640, height: 360 }, 2)).toEqual({ width: 1280, height: 720 });
    expect(devicePixelSize({ width: 641, height: 361 }, 1.5)).toEqual({ width: 962, height: 542 });
    expect(devicePixelSize({ width: 640, height: 360 }, Number.NaN)).toEqual({
      width: 640,
      height: 360,
    });
  });
});
