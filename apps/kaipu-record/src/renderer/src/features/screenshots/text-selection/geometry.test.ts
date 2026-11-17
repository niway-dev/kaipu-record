import { describe, expect, it } from "vitest";
import type { RecognizedWord } from "@kaipu/domain/schemas";
import type { Annotation } from "../annotations/scene";
import { nearestWord, redactionRectsInPixels, wordBoxNorm, wordRange } from "./geometry";

const word = (text: string, x: number, y: number, w = 100, h = 20): RecognizedWord => ({
  text,
  line: 0,
  rect: { x, y, w, h },
  confidence: 1,
});
const NATURAL = { w: 1000, h: 500 };

describe("wordBoxNorm", () => {
  it("normalizes a pixel box to the image, like an annotation", () => {
    expect(wordBoxNorm(word("a", 100, 50, 200, 25), NATURAL)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.05,
    });
  });
});

describe("nearestWord", () => {
  const a = word("a", 100, 100);
  const b = word("b", 600, 100);

  it("is 0 px away on the word", () => {
    expect(nearestWord([a, b], { x: 0.15, y: 0.22 }, NATURAL, { w: 500, h: 250 })).toEqual({
      index: 0,
      distPx: 0,
    });
  });

  it("measures the distance on screen, so the same spot is nearer when zoomed out", () => {
    // 0.05 normalized to the left of "a" (its left edge is at 0.1).
    const p = { x: 0.05, y: 0.22 };
    const small = nearestWord([a, b], p, NATURAL, { w: 500, h: 250 });
    const big = nearestWord([a, b], p, NATURAL, { w: 1000, h: 500 });
    expect(small).toEqual({ index: 0, distPx: 25 });
    expect(big).toEqual({ index: 0, distPx: 50 });
  });

  it("picks the same word at any zoom for a point on it (pan and zoom only rescale)", () => {
    const p = { x: 0.65, y: 0.22 };
    for (const display of [
      { w: 250, h: 125 },
      { w: 1000, h: 500 },
      { w: 4000, h: 2000 },
    ]) {
      expect(nearestWord([a, b], p, NATURAL, display)).toEqual({ index: 1, distPx: 0 });
    }
  });

  it("is null with no words", () => {
    expect(nearestWord([], { x: 0, y: 0 }, NATURAL, { w: 1, h: 1 })).toBeNull();
  });
});

describe("wordRange", () => {
  const ws = ["a", "b", "c", "d"].map((t, i) => word(t, i * 100, 0));
  it("is inclusive and order-independent", () => {
    expect(wordRange(ws, ws[1], ws[3]).map((w) => w.text)).toEqual(["b", "c", "d"]);
    expect(wordRange(ws, ws[3], ws[1]).map((w) => w.text)).toEqual(["b", "c", "d"]);
  });
  it("is empty when an end is not among the words", () => {
    expect(wordRange(ws, ws[0], word("z", 0, 0))).toEqual([]);
  });
});

describe("redactionRectsInPixels", () => {
  const blur = (over: Partial<Annotation> = {}): Annotation =>
    ({ id: "b", kind: "blur", x: 0.125, y: 0.25, w: 0.25, h: 0.25, ...over }) as Annotation;
  const box = { id: "x", kind: "box", x: 0, y: 0, w: 1, h: 1, color: "#fff", stroke: 0, seed: 1 };

  it("converts a normalized redaction to base pixels, and ignores other shapes", () => {
    expect(redactionRectsInPixels([blur(), box as Annotation], NATURAL)).toEqual([
      { x: 125, y: 125, w: 250, h: 125 },
    ]);
  });

  it("rounds out to whole pixels and clamps to the image, like the bake", () => {
    expect(
      redactionRectsInPixels([blur({ x: -0.0004, w: 1.5, y: 0.2005, h: 0.1 })], NATURAL),
    ).toEqual([{ x: 0, y: 100, w: 1000, h: 51 }]);
  });

  it("counts a locked redaction too", () => {
    expect(redactionRectsInPixels([blur({ locked: true })], NATURAL)).toHaveLength(1);
  });

  it("is empty for an image of unknown size", () => {
    expect(redactionRectsInPixels([blur()], { w: 0, h: 0 })).toEqual([]);
  });

  it("measures a redaction against the whole base asset when the base was resized", () => {
    // Illustrative: NATURAL is 1000 x 500. The asset at half size with its corner at normalized
    // (1, 0) covers x 1..1.5, y 0..0.5; the blur at x 1.125, w 0.25 is a quarter in, a half wide.
    expect(
      redactionRectsInPixels([blur({ x: 1.125, y: 0.125, w: 0.25, h: 0.25 })], NATURAL, {
        x: 1,
        y: 0,
        scale: 0.5,
      }),
    ).toEqual([{ x: 250, y: 125, w: 500, h: 250 }]);
  });

  it("fails closed on an invalid placement: the whole image counts as redacted", () => {
    expect(redactionRectsInPixels([blur()], NATURAL, { x: 0, y: 0, scale: 0 })).toEqual([
      { x: 0, y: 0, w: 1000, h: 500 },
    ]);
  });
});
