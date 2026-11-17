import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REDACTION_MIN_BLOCK_PX,
  REDACTION_SOLID_RGB,
  bakeCanvasRedactions,
  bakeRedactions,
  redactRegion,
  redactionBlockSize,
  withoutRedactedText,
  type PixelRegion,
} from "./redaction";
import { buildCanvasDoc, parseCanvasDoc } from "./canvas-doc";
import type { Annotation, Scene } from "./scene";

function region(
  width: number,
  height: number,
  fn: (x: number, y: number) => number[],
): PixelRegion {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}

describe("redactionBlockSize", () => {
  it("is at least 24 px and at least a quarter of the region's shorter side", () => {
    expect(REDACTION_MIN_BLOCK_PX).toBe(24);
    expect(redactionBlockSize(40, 400)).toBe(24);
    expect(redactionBlockSize(200, 400)).toBe(50);
    expect(redactionBlockSize(10, 10)).toBe(24);
    expect(redactionBlockSize(401, 900)).toBe(101);
  });
});

describe("redactRegion", () => {
  it("solid fills every pixel exactly, opaque", () => {
    const r = region(7, 5, (x, y) => [x, y, 9, 3]);
    redactRegion(r, "solid");
    for (let i = 0; i < r.data.length; i += 4) {
      expect([r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]]).toEqual([
        ...REDACTION_SOLID_RGB,
        255,
      ]);
    }
  });

  it("turns a region smaller than one block uniform", () => {
    const r = region(10, 10, (x, y) => [x * 20, y * 20, (x + y) * 5, 255]);
    redactRegion(r, "blur");
    for (let i = 4; i < r.data.length; i += 4) {
      expect(r.data.slice(i, i + 4)).toEqual(r.data.slice(0, 4));
    }
  });

  it("changes every pixel of a checkerboard whose block averages differ from it", () => {
    const r = region(96, 96, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const before = new Uint8ClampedArray(r.data);
    redactRegion(r, "blur");
    for (let i = 0; i < r.data.length; i += 4) {
      expect(r.data[i]).not.toBe(before[i]);
    }
  });

  it("depends only on the block averages: permuting pixels inside each block changes nothing", () => {
    const w = 100;
    const h = 60; // block = 24: edge blocks are smaller
    const a = region(w, h, (x, y) => [
      (x * 7 + y * 3) % 256,
      (x * y) % 256,
      (x + 2 * y) % 256,
      255,
    ]);
    const b: PixelRegion = { data: new Uint8ClampedArray(a.data), width: w, height: h };
    const block = redactionBlockSize(w, h);
    // Reverse the pixel order inside every block row-wise and column-wise.
    for (let by = 0; by < h; by += block) {
      for (let bx = 0; bx < w; bx += block) {
        const x1 = Math.min(bx + block, w);
        const y1 = Math.min(by + block, h);
        const px: number[][] = [];
        for (let y = by; y < y1; y++)
          for (let x = bx; x < x1; x++)
            px.push(Array.from(a.data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)));
        px.reverse();
        let k = 0;
        for (let y = by; y < y1; y++)
          for (let x = bx; x < x1; x++) b.data.set(px[k++], (y * w + x) * 4);
      }
    }
    expect(b.data).not.toEqual(a.data);
    redactRegion(a, "blur");
    redactRegion(b, "blur");
    expect(b.data).toEqual(a.data);
  });
});

describe("bakeRedactions", () => {
  it("returns the same bytes object when there is nothing to redact", async () => {
    const bytes = new ArrayBuffer(8);
    const other: Annotation = {
      id: "a1",
      kind: "box",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      color: "#fff",
      stroke: 2,
      seed: 1,
    };
    const locked: Annotation = { id: "a2", kind: "blur", x: 0, y: 0, w: 1, h: 1, locked: true };
    expect(await bakeRedactions(bytes, [])).toBe(bytes);
    expect(await bakeRedactions(bytes, [other, locked])).toBe(bytes);
  });
});

/**
 * jsdom has no canvas, so the browser pieces `bakeRedactions` leans on are faked. A fake
 * "PNG" is the JSON of its size; baking one re-encodes it with the pixel rects that were
 * written back, which is what these tests read to see WHERE each image was redacted.
 */
const enc = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer;
const dec = (b: ArrayBuffer): { w: number; h: number; rects?: Rect[] } =>
  JSON.parse(new TextDecoder().decode(b));
type Rect = { x: number; y: number; w: number; h: number };

function fakeBrowser(): void {
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsText(blob);
    });
    const { w, h } = JSON.parse(text) as { w: number; h: number };
    return { width: w, height: h, close: () => undefined };
  });
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return real(tag);
    const rects: Rect[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: (img: { width: number; height: number }, x: number, y: number) =>
          rects.push({ x, y, w: img.width, h: img.height }),
      }),
      toBlob: (cb: (b: unknown) => void) =>
        cb({ arrayBuffer: async () => enc({ w: canvas.width, h: canvas.height, rects }) }),
    };
    return canvas;
  }) as typeof document.createElement);
}

describe("bakeCanvasRedactions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Illustrative: a 1000x600 base and a 500x300 image to its right at x = 1.25 (world
  // 1250..1750). Every fraction is a power-of-two multiple, so the pixel rects are exact.
  const base = enc({ w: 1000, h: 600 });
  const picture = enc({ w: 500, h: 300 });
  const assets = { "img-aaaaaaaaaaaa": picture };
  const image: Annotation = {
    id: "i",
    kind: "image",
    assetId: "img-aaaaaaaaaaaa",
    x: 1.25,
    y: 0,
    w: 0.5,
    h: 0.5,
    pixelWidth: 500,
    pixelHeight: 300,
  };
  const blur = (over: Partial<Extract<Annotation, { kind: "blur" }>>): Annotation => ({
    id: "b",
    kind: "blur",
    x: 0,
    y: 0,
    w: 0.125,
    h: 0.125,
    ...over,
  });

  it("changes the added image and not the base when the blur misses the base", async () => {
    fakeBrowser();
    // World x 1375..1500, y 75..225: entirely over the added image.
    const out = await bakeCanvasRedactions(base, assets, [
      image,
      blur({ x: 1.375, y: 0.125, w: 0.125, h: 0.25 }),
    ]);
    expect(out.base).toBe(base);
    expect(out.assets["img-aaaaaaaaaaaa"]).not.toBe(picture);
    // Local to the image: x (1.375-1.25)/0.5 = .25 of 500 = 125, y .25 of 300 = 75.
    expect(dec(out.assets["img-aaaaaaaaaaaa"]).rects).toEqual([{ x: 125, y: 75, w: 125, h: 150 }]);
  });

  it("bakes a blur that spans both into both, each in its own local coordinates", async () => {
    fakeBrowser();
    // World x 750..1375: the right quarter of the base and the left part of the image.
    const out = await bakeCanvasRedactions(base, assets, [
      image,
      blur({ x: 0.75, y: 0.125, w: 0.625, h: 0.25 }),
    ]);
    expect(out.base).not.toBe(base);
    expect(dec(out.base).rects).toEqual([{ x: 750, y: 75, w: 250, h: 150 }]);
    expect(dec(out.assets["img-aaaaaaaaaaaa"]).rects).toEqual([{ x: 0, y: 75, w: 125, h: 150 }]);
  });

  it("bakes a blur over the cropped-out part of an image, in asset-local coordinates", async () => {
    fakeBrowser();
    // The image shows the right half of a 500x300 asset: the visible rect is world
    // 1250..1500 (w .25), so the whole asset spans world 1000..1500 (x = 1.0, w = .5).
    // The blur sits at world 1000..1125, entirely in the half that is cropped out.
    const cropped: Annotation = {
      ...image,
      x: 1.25,
      w: 0.25,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    const out = await bakeCanvasRedactions(base, assets, [
      cropped,
      blur({ x: 1, y: 0.125, w: 0.125, h: 0.25 }),
    ]);
    // Local to the whole asset: x 0..0.25 of 500 = 125 px, y (.125-0)/.5 = .25 of 300 = 75.
    expect(dec(out.assets["img-aaaaaaaaaaaa"]).rects).toEqual([{ x: 0, y: 75, w: 125, h: 150 }]);
  });

  it("bakes the hidden part of a blur that straddles the crop edge", async () => {
    fakeBrowser();
    const cropped: Annotation = {
      ...image,
      x: 1.25,
      w: 0.25,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    // World 1125..1375: hidden 1125..1250 and visible 1250..1375. Asset spans 1000..1500.
    const out = await bakeCanvasRedactions(base, assets, [
      cropped,
      blur({ x: 1.125, y: 0.125, w: 0.25, h: 0.25 }),
    ]);
    // Local: x (1.125-1)/.5 = .25 of 500 = 125, w .25/.5 = .5 of 500 = 250.
    expect(dec(out.assets["img-aaaaaaaaaaaa"]).rects).toEqual([{ x: 125, y: 75, w: 250, h: 150 }]);
  });

  it("privacy: one asset placed twice with different crops gets the blur of the hidden part once", async () => {
    fakeBrowser();
    // Placement A shows only the right half; placement B shows the whole asset elsewhere.
    // The blur is over A's hidden half (world 1000..1125) and misses B (1750..2250), so the
    // asset's bytes must be redacted through A's full rect: B alone would never touch them.
    const a: Annotation = {
      ...image,
      id: "A",
      x: 1.25,
      w: 0.25,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    const b: Annotation = { ...image, id: "B", x: 1.75, w: 0.5 };
    const out = await bakeCanvasRedactions(base, assets, [
      a,
      b,
      blur({ x: 1, y: 0.125, w: 0.125, h: 0.25 }),
    ]);
    expect(dec(out.assets["img-aaaaaaaaaaaa"]).rects).toEqual([{ x: 0, y: 75, w: 125, h: 150 }]);
  });

  it("does not bake a blur that misses the whole asset even when the crop is narrow", async () => {
    fakeBrowser();
    const cropped: Annotation = {
      ...image,
      x: 1.25,
      w: 0.25,
      crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    const out = await bakeCanvasRedactions(base, assets, [
      cropped,
      blur({ x: 0.125, y: 0.5, w: 0.125, h: 0.25 }),
    ]);
    expect(out.assets).toBe(assets);
  });

  it("changes the base and leaves the same asset objects when the blur misses the image", async () => {
    fakeBrowser();
    const out = await bakeCanvasRedactions(base, assets, [
      image,
      blur({ x: 0.125, y: 0.5, w: 0.125, h: 0.25 }),
    ]);
    expect(out.base).not.toBe(base);
    expect(out.assets).toBe(assets);
    expect(out.assets["img-aaaaaaaaaaaa"]).toBe(picture);
  });

  it("ignores locked blurs", async () => {
    fakeBrowser();
    const out = await bakeCanvasRedactions(base, assets, [
      image,
      blur({ x: 1.375, y: 0.125, locked: true }),
      blur({ x: 0.125, y: 0.125, locked: true }),
    ]);
    expect(out.base).toBe(base);
    expect(out.assets).toBe(assets);
  });

  it("returns the same objects when nothing needs redacting", async () => {
    // No browser fake: reaching the decoder at all would fail the test.
    const out = await bakeCanvasRedactions(base, assets, [image]);
    expect(out.base).toBe(base);
    expect(out.assets).toBe(assets);
  });

  it("does not take a touching edge for an overlap", async () => {
    fakeBrowser();
    // World x 1000..1250 is the gap between the base's right edge and the image's left edge.
    const out = await bakeCanvasRedactions(base, assets, [
      image,
      blur({ x: 1, y: 0.125, w: 0.25, h: 0.25 }),
    ]);
    expect(out.base).toBe(base);
    expect(out.assets).toBe(assets);
  });

  // The base, per-image crop unit 3. Illustrative: the 1000x600 base shown through a crop of
  // its right half. `bakeCanvasRedactions` never reads the crop, only where the whole asset sits.
  it("privacy: bakes a blur over the cropped-out part of the BASE (the crop is not an input)", async () => {
    fakeBrowser();
    // World x 0..125 (normalized 0..0.125) is the left half, which the base crop hides.
    const out = await bakeCanvasRedactions(base, assets, [
      blur({ x: 0, y: 0.125, w: 0.125, h: 0.25 }),
    ]);
    expect(out.base).not.toBe(base);
    expect(dec(out.base).rects).toEqual([{ x: 0, y: 75, w: 125, h: 150 }]);
  });

  it("privacy: redact over a cropped-out part, save, reopen and widen the crop: the pixels stay redacted", async () => {
    fakeBrowser();
    const hidden = blur({ x: 0, y: 0.125, w: 0.125, h: 0.25 });
    // The base is shown through its right half, so the blur sits over the part the crop hides.
    const cropped: Scene = {
      beautify: { bg: "ocean", padding: 24, radius: 8, shadow: 30 },
      annotations: [hidden],
      baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 },
    };
    // Save 1: the blur is baked into the whole asset even though the crop hides it.
    const first = await bakeCanvasRedactions(base, assets, cropped.annotations);
    expect(dec(first.base).rects).toEqual([{ x: 0, y: 75, w: 125, h: 150 }]);
    // The saved document marks the blur locked and keeps the crop.
    const reopened = parseCanvasDoc(
      JSON.stringify(buildCanvasDoc(cropped, { pixelWidth: 1000, pixelHeight: 600 })),
    )!;
    expect(reopened.scene.baseCrop).toEqual(cropped.baseCrop);
    expect(reopened.scene.annotations).toEqual([
      expect.objectContaining({ kind: "blur", locked: true }),
    ]);
    // Save 2, after the user widened the crop to the whole asset: the locked blur is not baked
    // again and the asset keeps the pixels of save 1, so nothing brings the original back.
    const widened = { ...reopened.scene, baseCrop: undefined };
    const second = await bakeCanvasRedactions(first.base, assets, widened.annotations);
    expect(second.base).toBe(first.base);
    expect(dec(second.base).rects).toEqual([{ x: 0, y: 75, w: 125, h: 150 }]);
  });

  it("bakes a blur into a resized base through the whole asset's placed rect", async () => {
    fakeBrowser();
    // The 1000x600 base at half size with its corner at normalized (1, 0): it covers x 1..1.5,
    // y 0..0.5. The blur at x 1.125..1.25, y 0.125..0.25 is a quarter of the way in, a quarter wide.
    const out = await bakeCanvasRedactions(
      base,
      assets,
      [blur({ x: 1.125, y: 0.125, w: 0.125, h: 0.125 })],
      { x: 1, y: 0, scale: 0.5 },
    );
    expect(dec(out.base).rects).toEqual([{ x: 250, y: 150, w: 250, h: 150 }]);
  });

  it("does not bake a blur that misses the resized base, even where the unmoved base was", async () => {
    fakeBrowser();
    // Normalized 0..0.125 lies over the base's ORIGINAL place; it now sits at x 1..1.5.
    const out = await bakeCanvasRedactions(
      base,
      assets,
      [blur({ x: 0, y: 0.125, w: 0.125, h: 0.125 })],
      { x: 1, y: 0, scale: 0.5 },
    );
    expect(out.base).toBe(base);
  });

  it("fails closed on an invalid base placement instead of guessing where the asset is", async () => {
    fakeBrowser();
    const hidden = [blur({ x: 0, y: 0.125, w: 0.125, h: 0.25 })];
    for (const placement of [
      { x: 0, y: 0, scale: 0 },
      { x: 0, y: 0, scale: -1 },
      { x: Number.NaN, y: 0, scale: 1 },
    ]) {
      await expect(bakeCanvasRedactions(base, assets, hidden, placement)).rejects.toThrow(
        /invalid placement/,
      );
    }
  });
});

describe("withoutRedactedText (NIW2-799)", () => {
  const size = { w: 200, h: 200 };
  // 7 chars at the S preset (19 px): about 0.37 x 0.12 of a 200 px image.
  const text = (id: string, x: number, y: number): Annotation => ({
    id,
    kind: "text",
    x,
    y,
    text: "hunter2",
    color: "#f00",
    size: 1,
  });
  const blur = (id: string, x: number, y: number, w: number, h: number): Annotation => ({
    id,
    kind: "blur",
    x,
    y,
    w,
    h,
    style: "solid",
  });
  const ids = (list: Annotation[]) => list.map((a) => a.id);

  it("drops a text a later redaction covers entirely", () => {
    const list = [text("t", 0.3, 0.5), blur("b", 0.25, 0.45, 0.5, 0.25)];
    expect(ids(withoutRedactedText(list, size))).toEqual(["b"]);
  });

  it("keeps a text the redaction covers only in part", () => {
    const list = [text("t", 0.3, 0.5), blur("b", 0.25, 0.45, 0.2, 0.25)];
    expect(ids(withoutRedactedText(list, size))).toEqual(["t", "b"]);
  });

  it("keeps a text drawn after the redaction: it sits on top of it", () => {
    const list = [blur("b", 0.25, 0.45, 0.5, 0.25), text("t", 0.3, 0.5)];
    expect(ids(withoutRedactedText(list, size))).toEqual(["b", "t"]);
  });

  it("drops a text that two redactions side by side cover together", () => {
    const list = [
      text("t", 0.3, 0.5),
      blur("b1", 0.25, 0.45, 0.2, 0.25),
      blur("b2", 0.44, 0.45, 0.3, 0.25),
    ];
    expect(ids(withoutRedactedText(list, size))).toEqual(["b1", "b2"]);
  });

  it("keeps a text when two redactions leave a gap between them", () => {
    const list = [
      text("t", 0.3, 0.5),
      blur("b1", 0.25, 0.45, 0.1, 0.25),
      blur("b2", 0.5, 0.45, 0.25, 0.25),
    ];
    expect(ids(withoutRedactedText(list, size))).toEqual(["t", "b1", "b2"]);
  });

  it("keeps everything when the displayed size is unknown", () => {
    const list = [text("t", 0.3, 0.5), blur("b", 0.25, 0.45, 0.5, 0.25)];
    expect(ids(withoutRedactedText(list, { w: 0, h: 0 }))).toEqual(["t", "b"]);
  });
});
