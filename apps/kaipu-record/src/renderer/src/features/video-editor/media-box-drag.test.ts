import { describe, expect, it } from "vitest";
import { mediaBoxPx } from "./media";
import { dragBoxBody, dragBoxCorner, MIN_RESIZE_WIDTH, type Corner } from "./media-box-drag";

const picture = { width: 1000, height: 500 };
// A 2:1 image, 40 % of the picture wide, centred: 400 x 200 px, from (300, 150) to (700, 350).
const item = { box: { x: 0.5, y: 0.5, width: 0.4 }, naturalWidth: 200, naturalHeight: 100 };

function after(corner: Corner, dx: number, dy: number) {
  const box = dragBoxCorner(item, corner, dx, dy, picture);
  return { box, rect: mediaBoxPx({ ...item, box }, picture) };
}

describe("dragBoxBody", () => {
  it("moves the centre by the pointer delta as a share of the picture and keeps the width", () => {
    expect(dragBoxBody(item.box, 100, -50, picture)).toEqual({ x: 0.6, y: 0.4, width: 0.4 });
  });
});

describe("dragBoxCorner", () => {
  it("dragging the south-east corner out keeps the north-west corner fixed", () => {
    const { rect } = after("se", 100, 0);
    expect(rect.x).toBeCloseTo(300);
    expect(rect.y).toBeCloseTo(150);
    expect(rect.width).toBeCloseTo(500);
  });

  it("keeps the opposite corner fixed for every corner", () => {
    const fixed = {
      nw: (r: { x: number; y: number; width: number; height: number }) => [
        r.x + r.width,
        r.y + r.height,
      ],
      ne: (r: { x: number; y: number; width: number; height: number }) => [r.x, r.y + r.height],
      sw: (r: { x: number; y: number; width: number; height: number }) => [r.x + r.width, r.y],
      se: (r: { x: number; y: number; width: number; height: number }) => [r.x, r.y],
    };
    const start = mediaBoxPx(item, picture);
    for (const corner of ["nw", "ne", "sw", "se"] as const) {
      const dx = corner.endsWith("e") ? 60 : -60;
      const dy = corner.startsWith("s") ? 20 : -20;
      const { rect } = after(corner, dx, dy);
      const [ex, ey] = fixed[corner](start);
      const [ax, ay] = fixed[corner](rect);
      expect(ax).toBeCloseTo(ex);
      expect(ay).toBeCloseTo(ey);
    }
  });

  it("shrinks when the corner is dragged inwards", () => {
    const { rect } = after("nw", 100, 50);
    expect(rect.width).toBeCloseTo(300);
    expect(rect.x + rect.width).toBeCloseTo(700);
  });

  it("follows the axis the pointer moved further along", () => {
    // Vertical reach 100 px at a 2:1 aspect is 200 px of width: wider than the horizontal 10 px.
    const { rect } = after("se", 10, 100);
    expect(rect.width).toBeCloseTo(600);
  });

  it("never goes below the minimum width, nor beyond the picture's width", () => {
    expect(after("se", -2000, -2000).box.width).toBeCloseTo(MIN_RESIZE_WIDTH);
    expect(after("se", 5000, 0).box.width).toBeCloseTo(1);
  });
});
