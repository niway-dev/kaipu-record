import { describe, expect, it } from "vitest";
import { createColorsAnalyzer } from "./colors-client";

describe("createColorsAnalyzer (inline, no Worker)", () => {
  it("forwards progress and returns areas and bounds of a located color", async () => {
    // 10x10: a 5x5 white block in the top-left corner, black elsewhere.
    const width = 10;
    const height = 10;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = x < 5 && y < 5 ? 255 : 0;
        data.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
    const progress: number[] = [];
    const analyzer = createColorsAnalyzer({ width, height, data }, (d) => progress.push(d));
    await analyzer.analysis;
    expect(progress[progress.length - 1]).toBe(1);
    const located = await analyzer.locate({ kind: "color", rgb: 0xffffff });
    expect(located.matched).toBe(25);
    expect(located.areas).toBe(1);
    expect(located.bounds).toEqual({ x: 0, y: 0, w: 5, h: 5 });
  });
});

describe("createColorsAnalyzer on a cropped base (NIW2-876, AC2)", () => {
  // 8x2: the left half is red, the right half blue. The crop shows only the red half.
  const width = 8;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * width + x) * 4);
    }
  }
  const win = { x0: 0, y0: 0, x1: 4, y1: height };

  it("counts only the visible pixels", async () => {
    const analyzer = createColorsAnalyzer({ width, height, data }, undefined, win);
    const analysis = await analyzer.analysis;
    expect(analysis.counted).toBe(8);
    expect(analysis.distinct).toBe(1);
  });

  it("never locates a color that only the cropped-out pixels hold", async () => {
    const analyzer = createColorsAnalyzer({ width, height, data }, undefined, win);
    await analyzer.analysis;
    expect((await analyzer.locate({ kind: "color", rgb: 0x0000ff })).matched).toBe(0);
    expect((await analyzer.locate({ kind: "color", rgb: 0xff0000 })).matched).toBe(8);
  });

  it("leaves the caller's pixels untouched", async () => {
    const before = data.slice();
    const analyzer = createColorsAnalyzer({ width, height, data }, undefined, win);
    await analyzer.analysis;
    expect(data).toEqual(before);
  });
});
