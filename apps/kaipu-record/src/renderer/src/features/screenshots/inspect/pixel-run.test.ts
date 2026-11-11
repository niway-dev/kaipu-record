import { describe, expect, it } from "vitest";
import type { PixelBuffer } from "./pixel-buffer";
import {
  DEFAULT_TOLERANCE,
  clampTolerance,
  runLength,
  scanRun,
  wheelSteps,
  WHEEL_PX_PER_STEP,
} from "./pixel-run";

type Px = [number, number, number, number];
const W: Px = [255, 255, 255, 255];
const K: Px = [0, 0, 0, 255];
const B: Px = [40, 90, 200, 255];

/** A buffer from rows of pixels. */
function image(rows: Px[][]): PixelBuffer {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => row.forEach((px, x) => data.set(px, (y * width + x) * 4)));
  return { width, height, data };
}

/** One row: a black 1 px border around a 4 px blue fill, on white. */
const BUTTON_ROW: Px[] = [W, W, K, B, B, B, B, K, W, W];

describe("scanRun", () => {
  it("measures the horizontal run of the color under the cursor", () => {
    const run = scanRun(image([BUTTON_ROW]), 4, 0, "x", 0);
    expect(run).toEqual({ axis: "x", from: 3, to: 7, at: 0 });
    expect(runLength(run!)).toBe(4);
  });

  it("measures the vertical run on the cursor's column", () => {
    const col = BUTTON_ROW.map((px) => [W, px, W]);
    const run = scanRun(image(col), 1, 5, "y", 0);
    expect(run).toEqual({ axis: "y", from: 3, to: 7, at: 1 });
  });

  it("stops at the image edge", () => {
    expect(scanRun(image([BUTTON_ROW]), 0, 0, "x", 0)).toEqual({
      axis: "x",
      from: 0,
      to: 2,
      at: 0,
    });
    expect(scanRun(image([BUTTON_ROW]), 9, 0, "x", 0)).toEqual({
      axis: "x",
      from: 8,
      to: 10,
      at: 0,
    });
  });

  it("returns null off the image (padding, empty canvas)", () => {
    const buf = image([BUTTON_ROW]);
    expect(scanRun(buf, -1, 0, "x", 10)).toBeNull();
    expect(scanRun(buf, 10, 0, "x", 10)).toBeNull();
    expect(scanRun(buf, 0, 1, "x", 10)).toBeNull();
    expect(scanRun(buf, 1.5, 0, "x", 10)).toBeNull();
  });

  it("compares with the starting pixel, so a gradient is not walked end to end", () => {
    // Each step changes red by 4: every neighbor is within 5, but only two steps are.
    const row: Px[] = Array.from({ length: 12 }, (_, i) => [100 + 4 * i, 0, 0, 255]);
    const run = scanRun(image([row]), 6, 0, "x", 5);
    expect(run).toEqual({ axis: "x", from: 5, to: 8, at: 0 });
  });

  it("widens with the tolerance", () => {
    const row: Px[] = [W, [250, 250, 250, 255], W, [230, 230, 230, 255], W];
    expect(runLength(scanRun(image([row]), 2, 0, "x", 0)!)).toBe(1);
    expect(runLength(scanRun(image([row]), 2, 0, "x", 5)!)).toBe(3);
    expect(runLength(scanRun(image([row]), 2, 0, "x", 30)!)).toBe(5);
  });

  it("counts alpha as a channel", () => {
    const row: Px[] = [W, [255, 255, 255, 0], W];
    expect(runLength(scanRun(image([row]), 0, 0, "x", 10)!)).toBe(1);
  });

  it("outer size reaches past the border on both sides", () => {
    const run = scanRun(image([BUTTON_ROW]), 4, 0, "x", 0, true);
    expect(run).toEqual({ axis: "x", from: 2, to: 8, at: 0 });
  });

  it("outer size keeps a side that already touches the image edge", () => {
    const row: Px[] = [B, B, K, W, W];
    expect(scanRun(image([row]), 0, 0, "x", 0, true)).toEqual({ axis: "x", from: 0, to: 3, at: 0 });
  });

  it("clamps the tolerance it is given", () => {
    expect(scanRun(image([BUTTON_ROW]), 4, 0, "x", 999)).toEqual({
      axis: "x",
      from: 0,
      to: 10,
      at: 0,
    });
  });
});

describe("clampTolerance", () => {
  it("keeps the tolerance an integer in 0–255", () => {
    expect(clampTolerance(-3)).toBe(0);
    expect(clampTolerance(300)).toBe(255);
    expect(clampTolerance(4.6)).toBe(5);
    expect(clampTolerance(Number.NaN)).toBe(DEFAULT_TOLERANCE);
  });
});

describe("wheelSteps", () => {
  it("raises the tolerance when scrolling up and lowers it when scrolling down", () => {
    expect(wheelSteps(0, { deltaX: 0, deltaY: -WHEEL_PX_PER_STEP, deltaMode: 0 }).steps).toBe(1);
    expect(wheelSteps(0, { deltaX: 0, deltaY: WHEEL_PX_PER_STEP * 2, deltaMode: 0 }).steps).toBe(
      -2,
    );
  });

  it("accumulates small trackpad deltas", () => {
    let rest = 0;
    let steps = 0;
    for (let i = 0; i < 10; i++) {
      const r = wheelSteps(rest, { deltaX: 0, deltaY: -WHEEL_PX_PER_STEP / 5, deltaMode: 0 });
      rest = r.rest;
      steps += r.steps;
    }
    expect(steps).toBe(2);
  });

  it("takes one step per line in line mode", () => {
    expect(wheelSteps(7, { deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({ steps: -1, rest: 0 });
  });

  it("uses the horizontal delta when Shift turned the wheel sideways", () => {
    expect(wheelSteps(0, { deltaX: -WHEEL_PX_PER_STEP, deltaY: 0, deltaMode: 0 }).steps).toBe(1);
  });

  it("ignores an empty delta", () => {
    expect(wheelSteps(5, { deltaX: 0, deltaY: 0, deltaMode: 0 })).toEqual({ steps: 0, rest: 5 });
  });
});
