import { describe, expect, it } from "vitest";
import { annotationBox, handlesFor, hitHandle, resizeAnnotation } from "./handles";
import { STEP_PX, TEXT_PX, resolveFontPx, textBoxPx } from "./tools";
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

const wrapped: Annotation = {
  id: "tw",
  kind: "text",
  x: 0.1,
  y: 0.1,
  text: "Dawd awdaw dwa d dawd awd wadwad",
  color: "#fff",
  size: 3,
  width: 0.4,
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
  // Excalidraw's shape: a dot in each corner to scale the text, both side midpoints
  // to set the width it wraps to. It used to be two handles on the same edge, which
  // read as "this box has no size" and gave the corner nothing to pull against.
  it("gives four corners and both side midpoints for text", () => {
    const h = handlesFor(text, size);
    expect(h.map((x) => x.id).sort()).toEqual(["e", "ne", "nw", "se", "sw", "w"]);
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
  // These two used to assert SNAPPING to the nearest preset, which is what made a
  // slow drag jump between four sizes. A corner now writes a free `fontPx`; the
  // presets stay as starting points rather than the only sizes that exist.
  it("grows the font continuously as the corner is dragged away", () => {
    const small = resizeAnnotation(text, "se", { x: 0.5, y: 0.5 }, size) as { fontPx: number };
    const bigger = resizeAnnotation(text, "se", { x: 0.5, y: 0.7 }, size) as { fontPx: number };
    const biggest = resizeAnnotation(text, "se", { x: 0.5, y: 0.9 }, size) as { fontPx: number };
    expect(bigger.fontPx).toBeGreaterThan(small.fontPx);
    expect(biggest.fontPx).toBeGreaterThan(bigger.fontPx);
    // Not a preset value: the point is that it lands between them.
    expect(TEXT_PX).not.toContain(bigger.fontPx);
  });
  it("never collapses the font to nothing, however far in the corner is dragged", () => {
    const patch = resizeAnnotation(text, "se", { x: 0.3, y: 0.3 }, size) as { fontPx: number };
    expect(patch.fontPx).toBeGreaterThanOrEqual(6);
  });
  it("scales from the opposite corner, so a north-west drag also grows the text", () => {
    const patch = resizeAnnotation(text, "nw", { x: 0.1, y: 0.05 }, size) as { fontPx: number };
    expect(patch.fontPx).toBeGreaterThan(0);
  });
  it("a side sets the wrap width from the horizontal drag (not the font)", () => {
    const patch = resizeAnnotation(text, "e", { x: 0.7, y: 0.3 }, size) as { width: number };
    expect(patch.width).toBeCloseTo(0.4); // 0.7 (drag x) − 0.3 (anchor x)
  });
  it("the west side keeps the right edge put, moving the origin instead", () => {
    const wide = { ...text, width: 0.4 };
    const patch = resizeAnnotation(wide, "w", { x: 0.4, y: 0.3 }, size) as {
      width: number;
      x: number;
    };
    expect(patch.x).toBeCloseTo(0.4);
    expect(patch.x + patch.width).toBeCloseTo(0.7); // right edge unmoved
  });
  it("scales a wrapped label by the drag/box ratio, not by the raw height", () => {
    // The label is 2 wrapped lines tall; dragging the corner to half the box height
    // must halve the font (deriving it from the raw height would pin it to the max).
    const b = annotationBox(wrapped, size)!;
    const patch = resizeAnnotation(
      wrapped,
      "se",
      { x: wrapped.x + b.w, y: wrapped.y + b.h / 2 },
      size,
    ) as { fontPx: number };
    // Half the box height halves the font. Deriving it from the raw height would pin
    // a multi-line label to the maximum and make the corner look dead.
    // Exact, not approximate: the font size is rounded to a whole pixel on purpose,
    // and "close to 18.5" is ambiguous at exactly half a pixel.
    expect(patch.fontPx).toBe(Math.round(TEXT_PX[wrapped.size] / 2));
  });
  it("keeps the corner a no-op when dragged to the current box corner", () => {
    const b = annotationBox(wrapped, size)!;
    const patch = resizeAnnotation(
      wrapped,
      "se",
      { x: wrapped.x + b.w, y: wrapped.y + b.h },
      size,
    ) as { fontPx: number };
    expect(patch.fontPx).toBeCloseTo(TEXT_PX[wrapped.size], 0);
  });
  it("scales the wrap width with the font so the label keeps its shape", () => {
    const b = annotationBox(wrapped, size)!;
    const patch = resizeAnnotation(
      wrapped,
      "se",
      { x: wrapped.x + b.w, y: wrapped.y + b.h / 2 },
      size,
    ) as { fontPx: number; width: number };
    // Halving the font halves the width, so the label keeps its shape rather than
    // reflowing into a taller, narrower block.
    expect(patch.width).toBeCloseTo(0.4 * (patch.fontPx / TEXT_PX[wrapped.size]), 2);
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
  it("picks the nearest handle when both ends of a short measure are in reach", () => {
    // 100 -> 105 on a 1000 px image: both ends sit within a 12 px tolerance.
    const m = {
      id: "m",
      kind: "measure" as const,
      axis: "x" as const,
      from: 100,
      to: 105,
      at: 50,
      imageW: 1000,
      imageH: 100,
      color: "#f6055c",
    };
    const handles = handlesFor(m, { w: 1000, h: 100 });
    const tol = { x: 0.012, y: 0.12 };
    expect(hitHandle(handles, { x: 0.105, y: 0.505 }, tol)).toBe("p2");
    expect(hitHandle(handles, { x: 0.1, y: 0.505 }, tol)).toBe("p1");
  });
  it("returns null when no handle is close", () => {
    const handles = handlesFor(box, size);
    expect(hitHandle(handles, { x: 0.4, y: 0.35 }, { x: 0.02, y: 0.02 })).toBeNull();
  });
});

/**
 * The handles are placed from `annotationBox`, and the label is drawn from
 * `textBoxPx` + `resolveFontPx`. If those two disagree the dots float away from the
 * box they are supposed to grab — which is exactly what shipped: `annotationBox`
 * read the preset `size` and ignored `fontPx`, so the moment a corner drag set a
 * free size the handles measured a different label than the one on screen.
 */
describe("annotationBox agrees with what is drawn", () => {
  const size = { w: 400, h: 300 };

  it("honours a free font size, not the preset index", () => {
    const preset = { ...text, size: 1, fontPx: undefined };
    const custom = { ...text, size: 1, fontPx: TEXT_PX[1] * 3 };

    const a = annotationBox(preset, size)!;
    const b = annotationBox(custom, size)!;

    // Three times the font is three times the box. Reading `size` would have made
    // these identical, which is the bug.
    expect(b.h).toBeCloseTo(a.h * 3, 5);
    expect(b.w).toBeCloseTo(a.w * 3, 5);
  });

  it("matches textBoxPx exactly, since that is what the renderer uses", () => {
    const custom = { ...text, size: 1, fontPx: 51 };
    const box = annotationBox(custom, size)!;
    const drawn = textBoxPx(custom.text, resolveFontPx(custom.size, custom.fontPx));

    expect(box.w).toBeCloseTo(drawn.w / size.w, 6);
    expect(box.h).toBeCloseTo(drawn.h / size.h, 6);
  });
});

describe("resizeAnnotation — canvas mode (NIW2-698)", () => {
  it("keeps a box inside the image by default", () => {
    const patch = resizeAnnotation(box, "se", { x: 1.4, y: 1.2 }, size) as { w: number; h: number };
    expect(patch.w).toBeCloseTo(1 - 0.2);
    expect(patch.h).toBeCloseTo(1 - 0.2);
  });

  it("lets a box edge follow the pointer past the image when canvas is on", () => {
    const patch = resizeAnnotation(box, "se", { x: 1.4, y: 1.2 }, size, true) as {
      w: number;
      h: number;
    };
    expect(patch.w).toBeCloseTo(1.4 - 0.2);
    expect(patch.h).toBeCloseTo(1.2 - 0.2);
  });

  it("lets an arrow endpoint leave the image when canvas is on, and not otherwise", () => {
    expect(resizeAnnotation(arrow, "p2", { x: -0.3, y: 1.5 }, size)).toEqual({ x2: 0, y2: 1 });
    expect(resizeAnnotation(arrow, "p2", { x: -0.3, y: 1.5 }, size, true)).toEqual({
      x2: -0.3,
      y2: 1.5,
    });
  });
});

describe("an added image resizes from its corners, ratio locked", () => {
  // 200 x 100 source px shown at 0.4 x 0.2 of a 1000 x 1000 layer: 400 x 200 layer px.
  const image: Annotation = {
    id: "i",
    kind: "image",
    assetId: "img-aaaaaaaaaaaa",
    x: 0.2,
    y: 0.3,
    w: 0.4,
    h: 0.2,
    pixelWidth: 200,
    pixelHeight: 100,
  };
  type Patch = { x: number; y: number; w: number; h: number };
  const resize = (handle: "nw" | "ne" | "se" | "sw" | "n" | "e", p: { x: number; y: number }) =>
    resizeAnnotation(image, handle, p, size, true) as Patch;

  it("has four corner handles and no edge handles", () => {
    expect(handlesFor(image, size).map((h) => h.id)).toEqual(["nw", "ne", "se", "sw"]);
  });

  it("grows from the se corner with the nw corner fixed and the pixel ratio kept", () => {
    const patch = resize("se", { x: 0.8, y: 0.4 }); // wider than tall: width leads
    expect(patch.x).toBeCloseTo(0.2);
    expect(patch.y).toBeCloseTo(0.3);
    expect(patch.w).toBeCloseTo(0.6);
    expect(patch.h).toBeCloseTo(0.3);
    expect((patch.w * 1000) / (patch.h * 1000)).toBeCloseTo(200 / 100);
  });

  it("lets the height lead when the pointer is further along vertically", () => {
    const patch = resize("se", { x: 0.3, y: 0.7 }); // dy 400 px -> width 800 px
    expect(patch.w).toBeCloseTo(0.8);
    expect(patch.h).toBeCloseTo(0.4);
  });

  it("keeps the opposite corner fixed from each corner", () => {
    const nw = resize("nw", { x: 0.4, y: 0.4 });
    expect(nw.x + nw.w).toBeCloseTo(0.6);
    expect(nw.y + nw.h).toBeCloseTo(0.5);
    const ne = resize("ne", { x: 0.9, y: 0.1 });
    expect(ne.x).toBeCloseTo(0.2);
    expect(ne.y + ne.h).toBeCloseTo(0.5);
    const sw = resize("sw", { x: 0.1, y: 0.8 });
    expect(sw.x + sw.w).toBeCloseTo(0.6);
    expect(sw.y).toBeCloseTo(0.3);
  });

  it("does not flip past the anchor and keeps a minimum size", () => {
    const patch = resize("se", { x: 0.0, y: 0.0 });
    expect(patch.x).toBeCloseTo(0.2);
    expect(patch.w * 1000).toBeGreaterThanOrEqual(24);
    expect(patch.h * 1000).toBeGreaterThanOrEqual(12);
    expect((patch.w * 1000) / (patch.h * 1000)).toBeCloseTo(2);
  });

  it("ignores an edge handle", () => {
    expect(resize("e", { x: 0.9, y: 0.4 })).toEqual({});
    expect(resize("n", { x: 0.4, y: 0.0 })).toEqual({});
  });
});

describe("a cropped image resizes without stretching and keeps its crop", () => {
  // Illustrative: a 200 x 100 asset showing its right half (100 x 100 source px, a square),
  // drawn as 0.2 x 0.2 of a 1000 x 1000 layer: 200 x 200 layer px.
  const cropped: Annotation = {
    id: "c",
    kind: "image",
    assetId: "img-aaaaaaaaaaaa",
    x: 0.2,
    y: 0.3,
    w: 0.2,
    h: 0.2,
    pixelWidth: 200,
    pixelHeight: 100,
    crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
  };
  type Patch = { x: number; y: number; w: number; h: number };
  const patch = (handle: "se" | "nw", p: { x: number; y: number }) =>
    resizeAnnotation(cropped, handle, p, size, true) as Patch & { crop?: unknown };

  it("locks the aspect of what shows (a square), not the asset's 2:1", () => {
    const out = patch("se", { x: 0.8, y: 0.4 }); // anchor x 0.2: width leads at 600 px
    expect(out.w).toBeCloseTo(0.6);
    expect(out.h).toBeCloseTo(0.6); // 2:1 would give 0.3
    expect((out.w * 1000) / (out.h * 1000)).toBeCloseTo(1);
  });
  it("the patch holds no crop, so applying it keeps the crop window", () => {
    expect("crop" in patch("se", { x: 0.8, y: 0.4 })).toBe(false);
    expect({ ...cropped, ...patch("se", { x: 0.8, y: 0.4 }) }).toMatchObject({
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    });
  });
  it("keeps the opposite corner fixed", () => {
    const out = patch("nw", { x: 0.1, y: 0.2 });
    expect(out.x + out.w).toBeCloseTo(0.4);
    expect(out.y + out.h).toBeCloseTo(0.5);
  });
});

describe("step badge", () => {
  const step: Annotation = { id: "s", kind: "step", x: 0.5, y: 0.5, color: "#fff", size: 1 };
  it("has no resize handles", () => {
    expect(handlesFor(step, size)).toEqual([]);
  });
  it("has a box centered on the badge, equal to the diameter in px", () => {
    const b = annotationBox(step, { w: 1000, h: 500 })!;
    expect(b.x + b.w / 2).toBeCloseTo(0.5);
    expect(b.y + b.h / 2).toBeCloseTo(0.5);
    expect(b.w * 1000).toBeCloseTo(STEP_PX[1]);
    expect(b.h * 500).toBeCloseTo(STEP_PX[1]);
  });
  it("resizeAnnotation never patches a step", () => {
    expect(resizeAnnotation(step, "se", { x: 0.9, y: 0.9 }, size)).toEqual({});
  });
});

describe("measure handles (NIW2-702)", () => {
  const ruler: Annotation = {
    id: "m",
    kind: "measure",
    axis: "y",
    from: 100,
    to: 300,
    at: 99,
    imageW: 200,
    imageH: 400,
    color: "#fff",
  };

  it("has two handles at the line ends and no box handles", () => {
    expect(handlesFor(ruler, size)).toEqual([
      { id: "p1", x: 0.4975, y: 0.25 },
      { id: "p2", x: 0.4975, y: 0.75 },
    ]);
  });

  it("dragging p2 moves only the to end, snapped to a pixel edge", () => {
    expect(resizeAnnotation(ruler, "p2", { x: 0.9, y: 0.5 }, size)).toEqual({ from: 100, to: 200 });
  });

  it("dragging p1 moves only the from end and never crosses the other end", () => {
    expect(resizeAnnotation(ruler, "p1", { x: 0.1, y: 0.2 }, size)).toEqual({ from: 80, to: 300 });
    expect(resizeAnnotation(ruler, "p1", { x: 0.1, y: 0.99 }, size)).toEqual({
      from: 299,
      to: 300,
    });
  });

  it("its box is the segment", () => {
    expect(annotationBox(ruler, size)).toEqual({ x: 0.4975, y: 0.25, w: 0, h: 0.5 });
  });
});
