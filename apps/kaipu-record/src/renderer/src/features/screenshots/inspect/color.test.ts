import { describe, expect, it } from "vitest";
import {
  OUT_OF_GAMUT_TOLERANCE,
  capturedFormat,
  formatCaptured,
  formatColor,
  p3ToSrgb,
  srgbToHsl,
  srgbToOklch,
  srgbToP3,
  type Rgb,
} from "./color";
import { sampleAt, type PixelBuffer } from "./pixel-buffer";

const SWATCHES = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#00ffff",
  "#ff00ff",
  "#808080",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#8b5cf6",
  "#1e293b",
  "#f8fafc",
];

const rgbOf = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** A synthetic 4x4 sRGB buffer made of the 16 swatches, row-major. */
function swatchBuffer(): PixelBuffer {
  const data = new Uint8ClampedArray(16 * 4);
  SWATCHES.forEach((hex, i) => {
    const [r, g, b] = rgbOf(hex);
    data.set([r, g, b, 255], i * 4);
  });
  return { width: 4, height: 4, data };
}

describe("sRGB swatches read back exactly", () => {
  it("returns every swatch as the same hex it was built from", () => {
    const buf = swatchBuffer();
    SWATCHES.forEach((hex, i) => {
      const px = sampleAt(buf, i % 4, Math.floor(i / 4))!;
      expect(formatColor(px, "hex")).toBe(hex);
    });
  });
});

describe("p3ToSrgb", () => {
  it("maps P3 white to sRGB white and P3 black to black, inside the gamut", () => {
    expect(p3ToSrgb([255, 255, 255])).toEqual({ rgb: [255, 255, 255], outOfGamut: false });
    expect(p3ToSrgb([0, 0, 0])).toEqual({ rgb: [0, 0, 0], outOfGamut: false });
  });

  it("flags P3 pure red: it is more saturated than any sRGB red", () => {
    const { rgb, outOfGamut } = p3ToSrgb([255, 0, 0]);
    expect(outOfGamut).toBe(true);
    expect(rgb).toEqual([255, 0, 0]); // clipped, not wrapped
  });

  it("reads every sRGB swatch, encoded as P3, back within one unit and in gamut", () => {
    for (const hex of SWATCHES) {
      const srgb = rgbOf(hex);
      const { rgb, outOfGamut } = p3ToSrgb(srgbToP3(srgb));
      expect(outOfGamut, hex).toBe(false);
      rgb.forEach((c, i) => expect(Math.abs(c - srgb[i]), `${hex} ${i}`).toBeLessThanOrEqual(1));
    }
  });

  it("stays in gamut when the P3 bytes are rounded to 8 bits, with a few units of error", () => {
    // One 8-bit P3 step is up to ~2-3 sRGB units near saturated colours (M0 measured 3 on
    // #00ff00), which is why the tolerance exists.
    for (const hex of SWATCHES) {
      const srgb = rgbOf(hex);
      const p3 = srgbToP3(srgb).map((c) => Math.min(255, Math.max(0, Math.round(c)))) as Rgb;
      const { rgb, outOfGamut } = p3ToSrgb(p3);
      expect(outOfGamut, hex).toBe(false);
      rgb.forEach((c, i) =>
        expect(Math.abs(c - srgb[i]), `${hex} ${i}`).toBeLessThan(OUT_OF_GAMUT_TOLERANCE),
      );
    }
  });

  it("keeps a margin for 8-bit quantization before it calls a colour out of sRGB", () => {
    expect(OUT_OF_GAMUT_TOLERANCE).toBe(4);
    // #00ff00 through an 8-bit P3 buffer lands a few units outside: still in gamut.
    const p3 = srgbToP3([0, 255, 0]).map(Math.round) as Rgb;
    expect(p3ToSrgb(p3).outOfGamut).toBe(false);
  });
});

describe("colour spaces", () => {
  it("converts #10b981 to HSL", () => {
    const { h, s, l } = srgbToHsl(rgbOf("#10b981"));
    expect([Math.round(h), Math.round(s), Math.round(l)]).toEqual([160, 84, 39]);
  });

  it("gives achromatic colours hue 0", () => {
    expect(srgbToOklch([128, 128, 128]).h).toBe(0);
    expect(srgbToHsl([128, 128, 128]).h).toBe(0);
  });

  it("puts white at OKLCH lightness 1 and black at 0", () => {
    expect(srgbToOklch([255, 255, 255]).l).toBeCloseTo(1, 3);
    expect(srgbToOklch([0, 0, 0]).l).toBeCloseTo(0, 3);
  });
});

describe("formatColor", () => {
  const emerald = { r: 16, g: 185, b: 129, a: 255 };

  it("prints #10b981 in all four formats", () => {
    expect(formatColor(emerald, "hex")).toBe("#10b981");
    expect(formatColor(emerald, "rgb")).toBe("rgb(16, 185, 129)");
    expect(formatColor(emerald, "hsl")).toBe("hsl(160, 84%, 39%)");
    expect(formatColor(emerald, "oklch")).toBe("oklch(0.696 0.149 162.5)");
  });

  it("adds alpha to each format", () => {
    const half = { ...emerald, a: 128 };
    expect(formatColor(half, "hex")).toBe("#10b98180");
    expect(formatColor(half, "rgb")).toBe("rgba(16, 185, 129, 0.5)");
    expect(formatColor(half, "hsl")).toBe("hsla(160, 84%, 39%, 0.5)");
    expect(formatColor(half, "oklch")).toBe("oklch(0.696 0.149 162.5 / 0.5)");
    expect(formatColor({ ...emerald, a: 64 }, "rgb")).toBe("rgba(16, 185, 129, 0.25)");
    expect(formatColor({ ...emerald, a: 0 }, "rgb")).toBe("rgba(16, 185, 129, 0)");
  });

  it("prints alpha with enough decimals to round-trip every 8-bit value", () => {
    expect(formatColor({ ...emerald, a: 1 }, "rgb")).toBe("rgba(16, 185, 129, 0.004)");
    expect(formatColor({ ...emerald, a: 254 }, "rgb")).toBe("rgba(16, 185, 129, 0.996)");
    expect(formatColor({ ...emerald, a: 254 }, "oklch")).toBe("oklch(0.696 0.149 162.5 / 0.996)");
    for (let a = 0; a < 255; a++) {
      const text = formatColor({ ...emerald, a }, "rgb");
      const printed = Number(text.slice(text.lastIndexOf(",") + 1, -1));
      expect(Math.round(printed * 255), `alpha ${a} printed as ${printed}`).toBe(a);
    }
  });
});

describe("as captured", () => {
  it("keeps hex and rgb and turns everything else into rgb", () => {
    expect(capturedFormat("hex")).toBe("hex");
    expect(capturedFormat("rgb")).toBe("rgb");
    expect(capturedFormat("hsl")).toBe("rgb");
    expect(capturedFormat("oklch")).toBe("rgb");
    const raw = { r: 10, g: 20, b: 30, a: 255 };
    expect(formatCaptured(raw, "hex")).toBe("#0a141e");
    expect(formatCaptured(raw, "oklch")).toBe("rgb(10, 20, 30)");
  });
});
