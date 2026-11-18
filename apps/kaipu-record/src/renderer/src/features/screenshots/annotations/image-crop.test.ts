import { describe, expect, it } from "vitest";
import {
  BASE_IMAGE_ID,
  MAX_BASE_SIDE_PX,
  MIN_CROP_PX,
  baseAsImage,
  cropHandleAt,
  cropTarget,
  imageCropPatch,
  resizeBasePlacement,
  resizeCropWindow,
  sameWindow,
  windowToCrop,
  wholeImage,
} from "./image-crop";
import { baseVisibleRect, type ImageAnnotation, type Scene } from "./scene";
import { MAX_BASE_SCALE, MIN_CROP, buildCanvasDoc, parseCanvasDoc } from "./canvas-doc";

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

  it("a window already below the minimum never leaves the asset: the asset bound wins", () => {
    // 10 px of the 200 px layer, under MIN_CROP_PX, hugging each edge in turn.
    const tiny = 0.05;
    const inside = (r: { x: number; y: number; w: number; h: number }): void => {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      expect(windowToCrop(full, r)?.w ?? 1).toBeLessThanOrEqual(1 + 1e-9);
    };
    const farRight = { x: 1 - tiny, y: 1 - tiny, w: tiny, h: tiny };
    const nearLeft = { x: 0, y: 0, w: tiny, h: tiny };
    for (const handle of ["e", "ne", "se"] as const) {
      inside(resizeCropWindow(farRight, full, handle, { x: 0.99, y: 0.99 }, SIZE));
    }
    for (const handle of ["s", "sw", "se"] as const) {
      inside(resizeCropWindow(farRight, full, handle, { x: 0.99, y: 0.99 }, SIZE));
    }
    for (const handle of ["w", "nw", "sw"] as const) {
      inside(resizeCropWindow(nearLeft, full, handle, { x: 0.01, y: 0.01 }, SIZE));
    }
    for (const handle of ["n", "nw", "ne"] as const) {
      inside(resizeCropWindow(nearLeft, full, handle, { x: 0.01, y: 0.01 }, SIZE));
    }
    // The east edge dragged inward on the far-right sliver stays on the asset's edge.
    expect(resizeCropWindow(farRight, full, "e", { x: 0.99, y: 0.5 }, SIZE).x).toBeCloseTo(
      1 - tiny,
    );
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

  describe("with a crop away from the origin and an existing placement", () => {
    // The lower-right quarter shows, the asset sits at (0.1, 0.2) at scale 1: visible rect
    // (0.6, 0.7, 0.5, 0.5), so its corners are nw (0.6,0.7), ne (1.1,0.7), sw (0.6,1.2), se (1.1,1.2).
    const base = {
      baseCrop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      basePlacement: { x: 0.1, y: 0.2, scale: 1 },
    };
    const corner = (b: typeof base, p: { x: number; y: number }, h: "nw" | "ne" | "sw" | "se") => {
      const v = baseVisibleRect({ ...b, basePlacement: p as never });
      return {
        x: h === "nw" || h === "sw" ? v.x : v.x + v.w,
        y: h === "nw" || h === "ne" ? v.y : v.y + v.h,
      };
    };

    it.each([
      ["se", { x: 1.6, y: 1.7 }, "nw", { x: 0.6, y: 0.7 }],
      ["nw", { x: 0.1, y: 0.2 }, "se", { x: 1.1, y: 1.2 }],
      ["ne", { x: 1.6, y: 0.2 }, "sw", { x: 0.6, y: 1.2 }],
      ["sw", { x: 0.1, y: 1.7 }, "ne", { x: 1.1, y: 0.7 }],
    ] as const)("dragging %s keeps the opposite visible corner (%s) fixed", (h, to, opp, fixed) => {
      const p = resizeBasePlacement(base, h, to, SIZE, natural)!;
      const c = corner(base, p, opp);
      expect(c.x).toBeCloseTo(fixed.x);
      expect(c.y).toBeCloseTo(fixed.y);
      expect(p.scale).toBeGreaterThan(1);
    });

    it("the crop is not touched and the visible window scales with the placement", () => {
      const p = resizeBasePlacement(base, "se", { x: 1.6, y: 1.7 }, SIZE, natural)!;
      const v = baseVisibleRect({ ...base, basePlacement: p });
      expect(v.w).toBeCloseTo(1);
      expect(v.h).toBeCloseTo(1);
    });

    it("the cap shrinks about the corner that stays: nw handle, opposite se fixed", () => {
      const p = resizeBasePlacement(base, "nw", { x: -100, y: -100 }, SIZE, natural)!;
      const v = baseVisibleRect({ ...base, basePlacement: p });
      expect(Math.max(v.w * natural.w, v.h * natural.h)).toBeCloseTo(MAX_BASE_SIDE_PX);
      expect(v.x + v.w).toBeCloseTo(1.1);
      expect(v.y + v.h).toBeCloseTo(1.2);
    });
  });

  it("baseAsImage is the visible rect with the asset's pixel size", () => {
    const img = baseAsImage({ baseCrop: { x: 0, y: 0, w: 0.5, h: 1 } }, natural);
    expect(img).toMatchObject({ id: BASE_IMAGE_ID, x: 0, y: 0, w: 0.5, h: 1, pixelWidth: 400 });
  });
});

describe("cropHandleAt", () => {
  // A 100 x 50 px window at (50, 50) of a 200 x 200 px layer.
  const win = { x: 0.25, y: 0.25, w: 0.5, h: 0.25 };
  const at = (px: number, py: number) => cropHandleAt(win, { x: px / 200, y: py / 200 }, SIZE, 10);

  it("finds a corner and an edge middle", () => {
    expect(at(52, 48)).toBe("nw");
    expect(at(148, 102)).toBe("se");
    expect(at(100, 51)).toBe("n");
    expect(at(149, 75)).toBe("e");
  });

  it("a press along an edge grabs that edge", () => {
    expect(at(75, 99)).toBe("s");
    expect(at(51, 60)).toBe("w");
  });

  it("a corner wins over the edge it sits on", () => {
    expect(at(55, 50)).toBe("nw");
  });

  it("inside the window and far from every edge is not a handle", () => {
    expect(at(100, 75)).toBeNull();
    expect(at(10, 10)).toBeNull();
  });
});

describe("wholeImage", () => {
  it("is the cropped image's whole asset: its full rect and no crop", () => {
    const whole = wholeImage(
      added({ x: 1.25, y: 0.5, w: 0.25, h: 0.25, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }),
    );
    expect(whole).toMatchObject({ x: 1, y: 0.5, w: 0.5, h: 0.25 });
    expect("crop" in whole).toBe(false);
  });

  it("leaves an uncropped image as it is", () => {
    const a = added();
    expect(wholeImage(a)).toBe(a);
  });
});

// The writer and the reader of the saved document must agree: a crop or resize the editor lets
// through has to reopen with its layers, never fall back to the flattened PNG.
describe("what the editor writes, the document reader reopens", () => {
  const beautify = { bg: "ocean", padding: 24, radius: 8, shadow: 30 } as Scene["beautify"];
  const reopens = (
    baseCrop: Scene["baseCrop"],
    basePlacement: Scene["basePlacement"],
    px: number,
  ): boolean => {
    const scene: Scene = { beautify, annotations: [], baseCrop, basePlacement };
    const doc = buildCanvasDoc(scene, { pixelWidth: px, pixelHeight: px });
    return parseCanvasDoc(JSON.stringify(doc)) !== null;
  };

  it("enlarging a tiny crop window never passes the reader's base scale ceiling", () => {
    // Illustrative: a 200 x 200 base cropped to 24 x 24 px, then the corner dragged to 3000 px.
    const natural = { w: 200, h: 200 };
    const baseCrop = { x: 0.4, y: 0.4, w: 0.12, h: 0.12 };
    const vis = baseVisibleRect({ baseCrop });
    const p = resizeBasePlacement(
      { baseCrop },
      "se",
      { x: vis.x + 15, y: vis.y + 15 },
      { w: 200, h: 200 },
      natural,
    )!;
    expect(p.scale).toBeLessThanOrEqual(MAX_BASE_SCALE);
    expect(reopens(baseCrop, p, 200)).toBe(true);
    // The cap shrinks about the corner that stays put (the nw corner of the window).
    const after = baseVisibleRect({ baseCrop, basePlacement: p });
    expect(after.x).toBeCloseTo(vis.x);
    expect(after.y).toBeCloseTo(vis.y);
  });

  it("shrinking a crop window on a scaled asset never passes the reader's minimum crop", () => {
    // Illustrative: a 1000 x 1000 base shown at 500 x 500, cropped to 5%, enlarged to scale 50.
    const full = { x: 0, y: 0, w: 50, h: 50 };
    const win = { x: 20, y: 20, w: 2.5, h: 2.5 };
    const r = resizeCropWindow(win, full, "se", { x: 0, y: 0 }, { w: 500, h: 500 });
    const crop = windowToCrop(full, r)!;
    expect(crop.w).toBeGreaterThanOrEqual(MIN_CROP);
    expect(crop.h).toBeGreaterThanOrEqual(MIN_CROP);
    expect(reopens(crop, { x: 0, y: 0, scale: 50 }, 1000)).toBe(true);
  });
});
