import { describe, expect, it } from "vitest";
import {
  BASE_IMAGE_ID,
  MAX_BASE_SIDE_PX,
  MIN_CROP_PX,
  baseAsImage,
  cropTarget,
  imageCropPatch,
  resizeBasePlacement,
  resizeCropWindow,
  sameWindow,
  windowToCrop,
} from "./image-crop";
import type { ImageAnnotation } from "./scene";

// Per-image crop, unit 4: the math behind the crop mode. Illustrative numbers throughout.

const added = (patch: Partial<ImageAnnotation> = {}): ImageAnnotation => ({
  id: "a3",
  kind: "image",
  assetId: "img-aaaaaaaaaaaa",
  x: 1,
  y: 0.5,
  w: 0.5,
  h: 0.25,
  pixelWidth: 200,
  pixelHeight: 100,
  ...patch,
});
const SIZE = { w: 200, h: 200 };

describe("cropTarget", () => {
  it("an uncropped added image: the window is the whole asset", () => {
    const t = cropTarget("a3", [added()], {});
    expect(t).toEqual({
      id: "a3",
      full: { x: 1, y: 0.5, w: 0.5, h: 0.25 },
      win: { x: 1, y: 0.5, w: 0.5, h: 0.25 },
    });
  });

  it("a cropped added image: the whole asset is larger than the window", () => {
    // The window shows the middle half of the asset on both axes.
    const t = cropTarget(
      "a3",
      [added({ x: 1, y: 0.5, w: 0.25, h: 0.125, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })],
      {},
    );
    expect(t!.win).toEqual({ x: 1, y: 0.5, w: 0.25, h: 0.125 });
    expect(t!.full).toEqual({ x: 0.875, y: 0.4375, w: 0.5, h: 0.25 });
  });

  it("the base answers to its own id, from the placement and the crop", () => {
    const t = cropTarget(BASE_IMAGE_ID, [], {
      basePlacement: { x: 0, y: 0, scale: 2 },
      baseCrop: { x: 0.25, y: 0, w: 0.5, h: 1 },
    });
    expect(t!.full).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(t!.win).toEqual({ x: 0.5, y: 0, w: 1, h: 2 });
  });

  it("an unknown id, or an id that is not an image, is no target", () => {
    expect(cropTarget("nope", [added()], {})).toBeNull();
    expect(cropTarget("b1", [{ id: "b1", kind: "blur", x: 0, y: 0, w: 1, h: 1 }], {})).toBeNull();
  });
});

describe("resizeCropWindow", () => {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  const win = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  it("an edge moves only that edge", () => {
    expect(resizeCropWindow(win, full, "w", { x: 0.1, y: 0.9 }, SIZE)).toEqual({
      x: 0.1,
      y: 0.25,
      w: 0.65,
      h: 0.5,
    });
  });

  it("a corner moves both of its edges", () => {
    const r = resizeCropWindow(win, full, "se", { x: 0.9, y: 0.8 }, SIZE);
    expect(r.x).toBe(0.25);
    expect(r.y).toBe(0.25);
    expect(r.w).toBeCloseTo(0.65);
    expect(r.h).toBeCloseTo(0.55);
  });

  it("never leaves the asset", () => {
    const r = resizeCropWindow(win, full, "nw", { x: -3, y: -3 }, SIZE);
    expect(r).toEqual({ x: 0, y: 0, w: 0.75, h: 0.75 });
    const r2 = resizeCropWindow(win, full, "se", { x: 9, y: 9 }, SIZE);
    expect(r2.x + r2.w).toBeCloseTo(1);
    expect(r2.y + r2.h).toBeCloseTo(1);
  });

  it("keeps a minimum size: the dragged edge stops before the opposite one", () => {
    const r = resizeCropWindow(win, full, "e", { x: 0, y: 0.5 }, SIZE);
    expect(r.w).toBeCloseTo(MIN_CROP_PX / SIZE.w);
    expect(r.x).toBe(0.25);
  });
});

describe("windowToCrop", () => {
  it("is the window as 0-1 of the asset", () => {
    expect(windowToCrop({ x: 1, y: 0, w: 2, h: 1 }, { x: 1.5, y: 0.25, w: 1, h: 0.5 })).toEqual({
      x: 0.25,
      y: 0.25,
      w: 0.5,
      h: 0.5,
    });
  });

  it("is undefined when the window covers the whole asset", () => {
    const full = { x: 0.3, y: 0.1, w: 0.7, h: 0.9 };
    expect(windowToCrop(full, { ...full })).toBeUndefined();
  });
});

describe("imageCropPatch / sameWindow", () => {
  it("writes the visible rect and the crop", () => {
    const t = cropTarget("a3", [added()], {})!;
    const win = { x: 1.125, y: 0.5, w: 0.25, h: 0.25 };
    expect(imageCropPatch(t, win)).toEqual({
      x: 1.125,
      y: 0.5,
      w: 0.25,
      h: 0.25,
      crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
    });
  });

  it("widening back to the whole asset clears the crop", () => {
    const t = cropTarget("a3", [added()], {})!;
    expect(imageCropPatch(t, t.full).crop).toBeUndefined();
  });

  it("sameWindow tells an unchanged window apart", () => {
    expect(sameWindow({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(sameWindow({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });
});

describe("resizeBasePlacement", () => {
  // A 400 x 400 base shown at 200 x 200: the layer is 200 px for 1 world unit.
  const natural = { w: 400, h: 400 };

  it("a corner drag scales the base about the opposite corner", () => {
    // Drag the se corner from (1,1) to (1.5,1.5): the base is 1.5x, the nw corner stays.
    const p = resizeBasePlacement({}, "se", { x: 1.5, y: 1.5 }, SIZE, natural);
    expect(p).toEqual({ x: 0, y: 0, scale: 1.5 });
  });

  it("the nw corner keeps the se corner put", () => {
    const p = resizeBasePlacement({}, "nw", { x: -0.5, y: -0.5 }, SIZE, natural)!;
    expect(p.scale).toBeCloseTo(1.5);
    expect(p.x + p.scale).toBeCloseTo(1);
    expect(p.y + p.scale).toBeCloseTo(1);
  });

  it("a cropped base scales the whole asset and keeps the crop out of the patch", () => {
    // The left half shows: visible 0..0.5 x 0..1. Drag se from (0.5,1) to (1,2): visible x2.
    const base = { baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } };
    const p = resizeBasePlacement(base, "se", { x: 1, y: 2 }, SIZE, natural)!;
    expect(p).toEqual({ x: 0, y: 0, scale: 2 });
  });

  it("an edge handle does nothing", () => {
    expect(resizeBasePlacement({}, "e", { x: 2, y: 0.5 }, SIZE, natural)).toBeNull();
  });

  it("stops at the largest visible side the export can hold", () => {
    const p = resizeBasePlacement({}, "se", { x: 1000, y: 1000 }, SIZE, natural)!;
    expect(p.scale * natural.w).toBeCloseTo(MAX_BASE_SIDE_PX);
    expect(p.x).toBe(0);
  });

  it("baseAsImage is the visible rect with the asset's pixel size", () => {
    const img = baseAsImage({ baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } }, natural);
    expect(img).toMatchObject({ id: BASE_IMAGE_ID, x: 0, y: 0, w: 0.5, h: 1, pixelWidth: 400 });
  });
});
