import { describe, expect, it } from "vitest";
import {
  clampFrameToDisplay,
  cropForDisplay,
  physicalSizeFor,
  toDisplayRelative,
  toGlobal,
  type DisplayLike,
} from "./capture-geometry";

function display(
  bounds: DisplayLike["bounds"],
  scaleFactor = 1,
  workArea: DisplayLike["workArea"] = bounds,
): DisplayLike {
  return { id: 1, bounds, scaleFactor, workArea };
}

const full1080 = { x: 0, y: 0, width: 1920, height: 1080 };

describe("cropForDisplay", () => {
  it("crops 1:1 on a 100% display", () => {
    const crop = cropForDisplay({ width: 1920, height: 1080 }, display(full1080), {
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    });
    expect(crop).toEqual({ x: 10, y: 10, width: 100, height: 100 });
  });

  it("scales a 150% display", () => {
    const d = display({ x: 0, y: 0, width: 1280, height: 720 }, 1.5);
    const crop = cropForDisplay({ width: 1920, height: 1080 }, d, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(crop).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it("scales a Retina 2x display", () => {
    const d = display({ x: 0, y: 0, width: 1440, height: 900 }, 2);
    const crop = cropForDisplay({ width: 2880, height: 1800 }, d, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(crop).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it("uses display-relative rects for a display left of the origin", () => {
    const d = display({ x: -1920, y: 0, width: 1920, height: 1080 });
    const relative = toDisplayRelative({ x: -1000, y: 50, width: 100, height: 100 }, d);
    expect(relative.x).toBe(920);
    const crop = cropForDisplay({ width: 1920, height: 1080 }, d, relative);
    expect(crop).toEqual({ x: 920, y: 50, width: 100, height: 100 });
  });

  it("derives the scale from the returned image when it is smaller than requested", () => {
    const d = display({ x: 0, y: 0, width: 2560, height: 1440 });
    const crop = cropForDisplay({ width: 1920, height: 1080 }, d, {
      x: 800,
      y: 200,
      width: 400,
      height: 400,
    });
    expect(crop).toEqual({ x: 600, y: 150, width: 300, height: 300 });
  });

  it("scales each axis independently when the aspect differs", () => {
    const d = display({ x: 0, y: 0, width: 2000, height: 1000 });
    const crop = cropForDisplay({ width: 1000, height: 800 }, d, {
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    expect(crop).toEqual({ x: 50, y: 80, width: 100, height: 160 });
  });

  it("floors the origin, ceils the size and clamps to the image", () => {
    const d = display({ x: 0, y: 0, width: 1000, height: 1000 });
    const crop = cropForDisplay({ width: 500, height: 500 }, d, {
      x: 3,
      y: 3,
      width: 5,
      height: 5,
    });
    expect(crop).toEqual({ x: 1, y: 1, width: 3, height: 3 });
    const edge = cropForDisplay({ width: 500, height: 500 }, d, {
      x: 995,
      y: 995,
      width: 50,
      height: 50,
    });
    expect(edge.x + edge.width).toBeLessThanOrEqual(500);
    expect(edge.y + edge.height).toBeLessThanOrEqual(500);
    expect(edge.width).toBeGreaterThanOrEqual(1);
  });
});

describe("clampFrameToDisplay", () => {
  it("moves a remembered frame back inside instead of dropping it", () => {
    const clamped = clampFrameToDisplay(
      { x: 1500, y: 900, width: 800, height: 600 },
      display(full1080),
    );
    expect(clamped).toEqual({ x: 1120, y: 480, width: 800, height: 600 });
  });

  it("clamps against a display at a negative origin, in display-relative space", () => {
    const left = display({ x: -1920, y: 0, width: 1920, height: 1080 });
    expect(clampFrameToDisplay({ x: 1500, y: 900, width: 800, height: 600 }, left)).toEqual({
      x: 1120,
      y: 480,
      width: 800,
      height: 600,
    });
    expect(clampFrameToDisplay({ x: -300, y: -50, width: 400, height: 300 }, left)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("shrinks an oversized frame to the work area, respecting its origin", () => {
    const d = display(full1080, 1, { x: 0, y: 25, width: 1920, height: 1055 });
    const clamped = clampFrameToDisplay({ x: 0, y: 0, width: 3000, height: 3000 }, d);
    expect(clamped).toEqual({ x: 0, y: 25, width: 1920, height: 1055 });
  });

  it("never returns less than 1x1", () => {
    const clamped = clampFrameToDisplay({ x: 10, y: 10, width: 0, height: -5 }, display(full1080));
    expect(clamped.width).toBe(1);
    expect(clamped.height).toBe(1);
  });
});

describe("physicalSizeFor", () => {
  it("rounds a fractional product to the nearest integer", () => {
    const d = display({ x: 0, y: 0, width: 1366, height: 768 }, 1.25);
    expect(physicalSizeFor(d)).toEqual({ width: 1708, height: 960 });
  });
});

describe("toGlobal", () => {
  it("is the inverse of toDisplayRelative", () => {
    const d = display({ x: -1920, y: 40, width: 1920, height: 1080 });
    const global = { x: -1000, y: 100, width: 10, height: 20 };
    expect(toGlobal(toDisplayRelative(global, d), d)).toEqual(global);
  });
});
