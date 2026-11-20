import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecognizedWord } from "@kaipu/domain/schemas";
import { bakeCanvasRedactions } from "../annotations/redaction";
import type { Annotation } from "../annotations/scene";
import {
  blockRedactionRect,
  lineBoxesNorm,
  nearestBlock,
  nearestWord,
  pixelRectToNorm,
  redactionRectsInPixels,
  selectableWords,
  textBlocks,
  wordBoxNorm,
} from "./index";

// Words are in the base ASSET's pixels. The editor's world has the asset at scale 1 with its
// corner at the origin, and a resized or moved base sits at its `basePlacement` of it
// (ADR 0053), so every conversion from asset pixels to the world goes through that rect
// (NIW2-876).
const NATURAL = { w: 1000, h: 500 };
// Half size, corner at world (1, 0.5): the asset covers x 1..1.5, y 0.5..1.
const PLACEMENT = { x: 1, y: 0.5, scale: 0.5 };
const word = (text: string, x: number, y: number, w = 100, h = 20, line = 0): RecognizedWord => ({
  text,
  line,
  rect: { x, y, w, h },
  confidence: 1,
});

describe("asset pixels to the world through the placed base (NIW2-876, AC3)", () => {
  it("wordBoxNorm puts a word inside the placed asset rect", () => {
    // Asset (100, 50) 200 x 25 is (0.1, 0.1) 0.2 x 0.05 of the asset; half scale from (1, 0.5).
    const box = wordBoxNorm(word("a", 100, 50, 200, 25), NATURAL, PLACEMENT);
    expect(box.x).toBeCloseTo(1 + 0.1 * 0.5, 10);
    expect(box.y).toBeCloseTo(0.5 + 0.1 * 0.5, 10);
    expect(box.w).toBeCloseTo(0.2 * 0.5, 10);
    expect(box.h).toBeCloseTo(0.05 * 0.5, 10);
  });

  it("is the old asset-normalized box when the base is not placed", () => {
    expect(wordBoxNorm(word("a", 100, 50, 200, 25), NATURAL)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.05,
    });
  });

  it("nearestWord measures against where the word is on the placed base", () => {
    const a = word("a", 100, 100);
    // World point on the word: asset (150, 110) -> (1 + 0.075, 0.5 + 0.11).
    const on = nearestWord([a], { x: 1.075, y: 0.61 }, NATURAL, { w: 500, h: 250 }, PLACEMENT);
    expect(on).toEqual({ index: 0, distPx: 0 });
    // The same point read as an unmoved base is nowhere near the word.
    const off = nearestWord([a], { x: 1.075, y: 0.61 }, NATURAL, { w: 500, h: 250 });
    expect(off!.distPx).toBeGreaterThan(100);
  });

  it("nearestBlock and lineBoxesNorm use the placed base too", () => {
    const blocks = textBlocks([word("a", 100, 100)]);
    expect(
      nearestBlock(blocks, { x: 1.075, y: 0.61 }, NATURAL, { w: 500, h: 250 }, PLACEMENT)?.distPx,
    ).toBe(0);
    const [line] = lineBoxesNorm([word("a", 100, 100)], NATURAL, PLACEMENT);
    expect(line.box.x).toBeCloseTo(1.05, 10);
  });

  it("pixelRectToNorm round-trips to the same whole pixels through redactionRectsInPixels", () => {
    // The pair the one-click hide and the text cache rely on: no pixel drifts either way.
    for (const placement of [PLACEMENT, { x: -0.37, y: 0.123, scale: 0.731 }, undefined]) {
      const r = { x: 137, y: 61, w: 211, h: 33 };
      const norm = pixelRectToNorm(r, NATURAL, placement);
      const blur: Annotation = { id: "b", kind: "blur", ...norm };
      expect(redactionRectsInPixels([blur], NATURAL, placement)).toEqual([r]);
    }
  });
});

describe("the one-click hide bakes over the same asset pixels (NIW2-876, AC3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  type Rect = { x: number; y: number; w: number; h: number };
  const enc = (v: unknown): ArrayBuffer =>
    new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer;
  // jsdom has no canvas: a fake "PNG" is the JSON of its size, re-encoded with the rects written back.
  function fakeBrowser(): void {
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(blob);
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
  const bakedRects = (bytes: ArrayBuffer): Rect[] =>
    (JSON.parse(new TextDecoder().decode(bytes)) as { rects?: Rect[] }).rects ?? [];

  for (const [name, placement] of [
    ["resized", { x: 0, y: 0, scale: 0.5 }],
    ["moved", { x: 1.25, y: -0.5, scale: 1 }],
    ["moved and resized", PLACEMENT],
  ] as const) {
    it(`a base ${name}: the stored redaction and the bake both land on the line's pixels`, async () => {
      fakeBrowser();
      const w = word("secret", 300, 200, 240, 24);
      const block = textBlocks([w])[0];
      const r = blockRedactionRect(block, [w], NATURAL);
      const blur: Annotation = { id: "b", kind: "blur", ...pixelRectToNorm(r, NATURAL, placement) };
      const out = await bakeCanvasRedactions(enc({ w: 1000, h: 500 }), {}, [blur], placement);
      expect(bakedRects(out.base)).toEqual([r]);
      // The blur covers the word.
      expect(r.x).toBeLessThanOrEqual(w.rect.x);
      expect(r.x + r.w).toBeGreaterThanOrEqual(w.rect.x + w.rect.w);
      expect(r.y).toBeLessThanOrEqual(w.rect.y);
      expect(r.y + r.h).toBeGreaterThanOrEqual(w.rect.y + w.rect.h);
    });
  }
});

describe("words in the cropped-out part are never offered (NIW2-876, AC4)", () => {
  // 1000 x 500 asset; the crop shows its right half (x 500..1000).
  const hidden = word("hidden", 100, 100);
  const shown = word("shown", 600, 100);
  const straddling = word("straddling", 450, 100, 100);
  const crop = { x: 0.5, y: 0, w: 0.5, h: 1 };

  it("drops the words in the hidden part, and the ones that cross the crop edge", () => {
    expect(selectableWords([hidden, shown, straddling], [], NATURAL, undefined, crop)).toEqual([
      shown,
    ]);
  });

  it("keeps every word when the base is not cropped", () => {
    expect(selectableWords([hidden, shown], [], NATURAL)).toEqual([hidden, shown]);
  });

  it("still removes the words a redaction covers, through the placement", () => {
    const placement = { x: 0, y: 0, scale: 0.5 };
    // Half size from the origin: a blur over world x 0.3..0.45 is asset px 600..900.
    const blur: Annotation = { id: "b", kind: "blur", x: 0.3, y: 0.1, w: 0.15, h: 0.2 };
    expect(selectableWords([hidden, shown], [blur], NATURAL, placement, crop)).toEqual([]);
  });

  it("offers nothing when the crop is not a real window (fails closed)", () => {
    expect(selectableWords([shown], [], NATURAL, undefined, { x: 0.5, y: 0, w: 0, h: 1 })).toEqual(
      [],
    );
  });
});
