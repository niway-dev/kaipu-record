import { describe, expect, it } from "vitest";
import {
  dragMeasureEnd,
  measureEndpoints,
  measureLabel,
  measureShape,
  measureTextColor,
  moveMeasure,
} from "./measure";
import type { MeasureAnnotation } from "./scene";

const H: MeasureAnnotation = {
  id: "m1",
  kind: "measure",
  axis: "x",
  from: 20,
  to: 60,
  at: 9,
  imageW: 200,
  imageH: 100,
  color: "#f6055c",
};
const V: MeasureAnnotation = { ...H, axis: "y", from: 10, to: 30, at: 49 };

describe("measureLabel", () => {
  it("is the length in image pixels", () => {
    expect(measureLabel(H)).toBe("40 px");
  });
});

describe("measureEndpoints", () => {
  it("runs a horizontal line through the middle of its row", () => {
    expect(measureEndpoints(H)).toEqual({ p1: { x: 0.1, y: 0.095 }, p2: { x: 0.3, y: 0.095 } });
  });
  it("runs a vertical line through the middle of its column", () => {
    expect(measureEndpoints(V)).toEqual({ p1: { x: 0.2475, y: 0.1 }, p2: { x: 0.2475, y: 0.3 } });
  });
});

describe("dragMeasureEnd", () => {
  it("moves one end along the axis and snaps it to a pixel edge", () => {
    expect(dragMeasureEnd(H, "to", { x: 0.4012, y: 0.9 })).toEqual({ from: 20, to: 80 });
    expect(dragMeasureEnd(V, "from", { x: 0.9, y: 0.051 })).toEqual({ from: 5, to: 30 });
  });
  it("stays inside the image", () => {
    expect(dragMeasureEnd(H, "from", { x: -1, y: 0 })).toEqual({ from: 0, to: 60 });
    expect(dragMeasureEnd(H, "to", { x: 3, y: 0 })).toEqual({ from: 20, to: 200 });
  });
  it("never crosses the other end", () => {
    expect(dragMeasureEnd(H, "from", { x: 0.9, y: 0 })).toEqual({ from: 59, to: 60 });
    expect(dragMeasureEnd(H, "to", { x: 0, y: 0 })).toEqual({ from: 20, to: 21 });
  });
});

describe("moveMeasure", () => {
  it("moves by whole pixels and keeps the length", () => {
    expect(moveMeasure(H, 0.051, 0.1)).toEqual({ from: 30, to: 70, at: 19 });
  });
  it("stops at the image's edges", () => {
    expect(moveMeasure(H, 5, 5)).toEqual({ from: 160, to: 200, at: 99 });
    expect(moveMeasure(H, -5, -5)).toEqual({ from: 0, to: 40, at: 0 });
  });
  it("swaps the roles of dx and dy for a vertical measurement", () => {
    expect(moveMeasure(V, 0.01, 0.1)).toEqual({ from: 20, to: 40, at: 51 });
  });
});

describe("measureShape label placement", () => {
  const inside = (p: { x: number; y: number; w: number; h: number }, W: number, H: number) =>
    p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H;
  it("puts the pill above a horizontal line, and below it on the top row", () => {
    const mid = measureShape({ ...H, at: 50 }, 200, 100);
    expect(mid.pill.y + mid.pill.h).toBeLessThan(mid.p1.y);
    const top = measureShape({ ...H, at: 0 }, 200, 100);
    expect(top.pill.y).toBeGreaterThan(top.p1.y);
    expect(inside(top.pill, 200, 100)).toBe(true);
  });
  it("puts the pill right of a vertical line, and left of it on the last column", () => {
    const mid = measureShape(V, 200, 100);
    expect(mid.pill.x).toBeGreaterThan(mid.p1.x);
    const right = measureShape({ ...V, at: 199 }, 200, 100);
    expect(right.pill.x + right.pill.w).toBeLessThan(right.p1.x);
    expect(inside(right.pill, 200, 100)).toBe(true);
  });
  it("keeps the pill inside an image too small for either side of the line", () => {
    expect(
      inside(measureShape({ ...H, from: 0, to: 40, at: 10, imageH: 30 }, 200, 30).pill, 200, 30),
    ).toBe(true);
    expect(
      inside(measureShape({ ...V, from: 0, to: 20, at: 10, imageW: 60 }, 60, 100).pill, 60, 100),
    ).toBe(true);
  });
  it("slides the pill along a short line at the image's corner so it stays inside", () => {
    const corner = measureShape({ ...H, from: 0, to: 2, at: 0 }, 200, 100);
    expect(inside(corner.pill, 200, 100)).toBe(true);
  });
});

describe("measureTextColor", () => {
  it("uses dark text on the light swatches and white on the dark ones", () => {
    expect(measureTextColor("#22c55e")).toBe("#1a1a1a");
    expect(measureTextColor("#f6055c")).toBe("#ffffff");
  });
});
