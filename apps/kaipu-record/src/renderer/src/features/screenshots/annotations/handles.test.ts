import { describe, expect, it } from "vitest";
import { annotationBox, handlesFor, hitHandle, resizeAnnotation } from "./handles";
import { TEXT_PX } from "./tools";
import type { Annotation } from "./scene";

const size = { w: 1000, h: 1000 };

const box: Annotation = {
  id: "b",
  kind: "box",
  x: 0.2,
  y: 0.2,
  w: 0.4,
  h: 0.3,
  color: "#fff",
  stroke: 1,
  seed: 1,
};
const arrow: Annotation = {
  id: "a",
  kind: "arrow",
  x1: 0.1,
  y1: 0.1,
  x2: 0.5,
  y2: 0.4,
  color: "#fff",
  stroke: 1,
  seed: 1,
};
const path: Annotation = {
  id: "p",
  kind: "path",
  points: [
    { x: 0.2, y: 0.2 },
    { x: 0.4, y: 0.3 },
    { x: 0.6, y: 0.2 },
  ],
  color: "#fff",
  stroke: 1,
};
const text: Annotation = {
  id: "t",
  kind: "text",
  x: 0.3,
  y: 0.3,
  text: "Hello",
  color: "#fff",
  size: 1,
};

describe("annotationBox", () => {
  it("returns the rect directly for box/blur", () => {
    expect(annotationBox(box, size)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.3 });
  });
  it("returns the min/max span for an arrow", () => {
    expect(annotationBox(arrow, size)).toEqual({
      x: 0.1,
      y: 0.1,
      w: expect.closeTo(0.4),
      h: expect.closeTo(0.3),
    });
  });
  it("returns the point extent for a path", () => {
    expect(annotationBox(path, size)).toEqual({
      x: 0.2,
      y: 0.2,
      w: expect.closeTo(0.4),
      h: expect.closeTo(0.1),
    });
  });
  it("returns null for an empty path", () => {
    expect(annotationBox({ ...path, points: [] }, size)).toBeNull();
  });
});

describe("handlesFor", () => {
  it("gives 8 handles for a box", () => {
    expect(handlesFor(box, size)).toHaveLength(8);
  });
  it("gives 8 handles for a path", () => {
    expect(handlesFor(path, size)).toHaveLength(8);
  });
  it("gives 2 endpoint handles for an arrow", () => {
    const h = handlesFor(arrow, size);
    expect(h.map((x) => x.id).sort()).toEqual(["p1", "p2"]);
  });
  it("gives a corner (font) and an east-edge (wrap width) handle for text", () => {
    const h = handlesFor(text, size);
    expect(h.map((x) => x.id).sort()).toEqual(["e", "se"]);
  });
});

describe("resizeAnnotation — box", () => {
  it("se corner grows width and height", () => {
    const patch = resizeAnnotation(box, "se", { x: 0.8, y: 0.9 }, size);
    expect(patch).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.6), h: expect.closeTo(0.7) });
  });
  it("nw corner moves the origin", () => {
    const patch = resizeAnnotation(box, "nw", { x: 0.1, y: 0.1 }, size) as {
      x: number;
      y: number;
      w: number;
      h: number;
    };
    expect(patch.x).toBeCloseTo(0.1);
    expect(patch.y).toBeCloseTo(0.1);
    expect(patch.w).toBeCloseTo(0.5); // right edge (0.6) fixed
    expect(patch.h).toBeCloseTo(0.4); // bottom edge (0.5) fixed
  });
  it("an east edge only changes width", () => {
    const patch = resizeAnnotation(box, "e", { x: 0.7, y: 0.99 }, size) as { y: number; h: number };
    expect(patch.y).toBeCloseTo(0.2); // top unchanged
    expect(patch.h).toBeCloseTo(0.3); // height unchanged
  });
  it("normalizes when dragged past the opposite edge (no negative size)", () => {
    const patch = resizeAnnotation(box, "se", { x: 0.0, y: 0.0 }, size) as { w: number; h: number };
    expect(patch.w).toBeGreaterThanOrEqual(0);
    expect(patch.h).toBeGreaterThanOrEqual(0);
  });
  it("clamps edges to the [0,1] canvas", () => {
    const patch = resizeAnnotation(box, "se", { x: 2, y: 2 }, size) as { w: number; h: number };
    expect(patch.w).toBeCloseTo(0.8); // right clamped to 1.0, left at 0.2
    expect(patch.h).toBeCloseTo(0.8);
  });
});

describe("resizeAnnotation — arrow", () => {
  it("p2 moves the second endpoint", () => {
    expect(resizeAnnotation(arrow, "p2", { x: 0.9, y: 0.8 }, size)).toEqual({ x2: 0.9, y2: 0.8 });
  });
  it("p1 moves the first endpoint", () => {
    expect(resizeAnnotation(arrow, "p1", { x: 0.05, y: 0.05 }, size)).toEqual({
      x1: 0.05,
      y1: 0.05,
    });
  });
});

describe("resizeAnnotation — path", () => {
  it("scales every point into the new bounding box", () => {
    // Grow the se corner from (0.6,0.3) to (1.0,0.5): width 0.4→0.8, height 0.1→0.3.
    const patch = resizeAnnotation(path, "se", { x: 1.0, y: 0.5 }, size) as {
      points: { x: number; y: number }[];
    };
    // First point sits at the box origin → unchanged.
    expect(patch.points[0].x).toBeCloseTo(0.2);
    expect(patch.points[0].y).toBeCloseTo(0.2);
    // Last point was at the right edge → maps to the new right edge.
    expect(patch.points[2].x).toBeCloseTo(1.0);
  });
  it("does not produce NaN for a perfectly flat stroke", () => {
    const flat: Annotation = {
      id: "f",
      kind: "path",
      points: [
        { x: 0.2, y: 0.5 },
        { x: 0.6, y: 0.5 },
      ],
      color: "#fff",
      stroke: 1,
    };
    const patch = resizeAnnotation(flat, "se", { x: 0.8, y: 0.7 }, size) as {
      points: { x: number; y: number }[];
    };
    patch.points.forEach((pt) => {
      expect(Number.isNaN(pt.x)).toBe(false);
      expect(Number.isNaN(pt.y)).toBe(false);
    });
  });
});

describe("resizeAnnotation — text", () => {
  it("snaps to a larger size level when the corner is dragged down", () => {
    // Drag the corner far below the anchor → large target px → top size level.
    const patch = resizeAnnotation(text, "se", { x: 0.5, y: 0.9 }, size) as { size: number };
    expect(patch.size).toBe(TEXT_PX.length - 1);
  });
  it("snaps to the smallest level when dragged close to the anchor", () => {
    const patch = resizeAnnotation(text, "se", { x: 0.31, y: 0.31 }, size) as { size: number };
    expect(patch.size).toBe(0);
  });
  it("the east edge sets the wrap width from the horizontal drag (not the font)", () => {
    const patch = resizeAnnotation(text, "e", { x: 0.7, y: 0.3 }, size) as { width: number };
    expect(patch.width).toBeCloseTo(0.4); // 0.7 (drag x) − 0.3 (anchor x)
  });
  it("clamps the wrap width to a small minimum, never zero/negative", () => {
    const patch = resizeAnnotation(text, "e", { x: 0.3, y: 0.3 }, size) as { width: number };
    expect(patch.width).toBeGreaterThan(0);
  });
});

describe("hitHandle", () => {
  it("returns the handle under the point within tolerance", () => {
    const handles = handlesFor(box, size);
    const tol = { x: 0.02, y: 0.02 };
    // se corner is at (0.6, 0.5).
    expect(hitHandle(handles, { x: 0.605, y: 0.495 }, tol)).toBe("se");
  });
  it("returns null when no handle is close", () => {
    const handles = handlesFor(box, size);
    expect(hitHandle(handles, { x: 0.4, y: 0.35 }, { x: 0.02, y: 0.02 })).toBeNull();
  });
});
