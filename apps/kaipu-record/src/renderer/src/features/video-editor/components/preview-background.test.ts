import { describe, expect, it } from "vitest";
import { BACKGROUND_IDS, backgroundPaint } from "../../screenshots/beautify/backgrounds";
import { backgroundFrame, DEFAULT_BACKGROUND, type VideoBackground } from "../background";
import { previewBackgroundStyle } from "./preview-background";

const MAGENTA: VideoBackground = { bg: "magenta", padding: 48, radius: 16, shadow: 24 };

/** `12.5px` → 12.5 */
const px = (value: unknown): number => parseFloat(String(value));

/** The frame's `--frame-bg` custom property. */
const frameBg = (frame: object): string => (frame as Record<string, string>)["--frame-bg"];

describe("previewBackgroundStyle", () => {
  it("is neutral with none, whatever the stored numbers are", () => {
    for (const background of [DEFAULT_BACKGROUND, { ...MAGENTA, bg: "none" as const }]) {
      expect(previewBackgroundStyle(background, 960, 540)).toEqual({ frame: {}, picture: {} });
    }
  });

  it("is neutral until the stage has a size", () => {
    expect(previewBackgroundStyle(MAGENTA, 0, 0)).toEqual({ frame: {}, picture: {} });
  });

  it("paints the frame with the preset's paint: the 135° gradient the export draws", () => {
    const { frame } = previewBackgroundStyle(MAGENTA, 960, 540);
    expect(frameBg(frame)).toBe("linear-gradient(135deg, #ff2d6e, #a3044a)");
  });

  // NIW2-668 review S1: the screenshot editor's Dark and Carbon CSS are theme tokens
  // (`var(--bg-app)`, `var(--bg-card)`); the composer paints the fixed hex of `paint`. The
  // video preview must show what the file will hold, in either theme.
  it.each(BACKGROUND_IDS.filter((id) => id !== "none"))(
    "the %s frame resolves to exactly the colours of its paint, not a theme token",
    (id) => {
      const frame = frameBg(previewBackgroundStyle({ ...MAGENTA, bg: id }, 960, 540).frame);
      const paint = backgroundPaint(id);
      if (paint.kind === "solid") {
        expect(frame).toBe(paint.color);
      } else if (paint.kind === "gradient") {
        expect(frame).toBe(`linear-gradient(135deg, ${paint.from}, ${paint.to})`);
      } else {
        throw new Error(`${id} has no paint`);
      }
      // A custom property that resolves through the app's theme would repaint with it.
      expect(frame).not.toMatch(/var\(/);
    },
  );

  it("is theme-independent: every preset is made of literal hex colours, so [data-theme] cannot repaint it", () => {
    const hex = /#[0-9a-f]{6}\b/gi;
    const themes = [undefined, "light", "dark"] as const;
    try {
      for (const id of BACKGROUND_IDS.filter((b) => b !== "none")) {
        const seen = new Set<string>();
        for (const theme of themes) {
          if (theme) document.documentElement.setAttribute("data-theme", theme);
          else document.documentElement.removeAttribute("data-theme");
          const value = frameBg(previewBackgroundStyle({ ...MAGENTA, bg: id }, 960, 540).frame);
          seen.add(value);
          // Nothing in it is resolved at paint time: no variable, no theme function.
          expect(value.replace(hex, "").replace(/linear-gradient\(135deg, , \)/, "")).toBe("");
        }
        expect(seen.size).toBe(1);
      }
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("does not depend on the stage size or on the padding, radius and shadow either", () => {
    for (const id of BACKGROUND_IDS.filter((b) => b !== "none")) {
      const base = frameBg(previewBackgroundStyle({ ...MAGENTA, bg: id }, 960, 540).frame);
      for (const [w, h] of [
        [640, 360],
        [540, 960],
        [1440, 810],
      ]) {
        for (const numbers of [{}, { padding: 0, radius: 0, shadow: 0 }, { padding: 96 }]) {
          const next = previewBackgroundStyle({ ...MAGENTA, ...numbers, bg: id }, w, h).frame;
          expect(frameBg(next)).toBe(base);
        }
      }
    }
  });

  it.each([
    [960, 540],
    [640, 360],
    [1440, 810],
    [540, 960],
    [600, 600],
  ])("uses exactly backgroundFrame's numbers at a %i×%i stage", (w, h) => {
    const { picture } = previewBackgroundStyle(MAGENTA, w, h);
    const frame = backgroundFrame(MAGENTA, w, h);
    expect(px(picture.left)).toBeCloseTo(frame.picture.x, 9);
    expect(px(picture.top)).toBeCloseTo(frame.picture.y, 9);
    expect(px(picture.width)).toBeCloseTo(frame.picture.width, 9);
    expect(px(picture.height)).toBeCloseTo(frame.picture.height, 9);
    expect(px(picture.borderRadius)).toBeCloseTo(frame.radius, 9);
    expect(picture.boxShadow).toBe(
      `0 ${frame.shadow!.offsetY}px ${frame.shadow!.blur}px rgba(0, 0, 0, ${frame.shadow!.alpha})`,
    );
  });

  it("scales the padding, radius and shadow with the stage like the export scales them with the output", () => {
    // The same background on a stage half the size is the same picture at half the numbers.
    const big = previewBackgroundStyle(MAGENTA, 1920, 1080).picture;
    const half = previewBackgroundStyle(MAGENTA, 960, 540).picture;
    expect(px(half.top) * 2).toBeCloseTo(px(big.top), 9);
    expect(px(half.width) * 2).toBeCloseTo(px(big.width), 9);
    expect(px(half.borderRadius) * 2).toBeCloseTo(px(big.borderRadius), 9);
  });

  it("keeps the picture on a very tall, narrow stage too (review C1)", () => {
    const { picture } = previewBackgroundStyle(
      { bg: "magenta", padding: 96, radius: 28, shadow: 100 },
      128,
      2160,
    );
    expect(px(picture.left)).toBeGreaterThanOrEqual(0);
    expect(px(picture.left) + px(picture.width)).toBeLessThanOrEqual(128);
    expect(px(picture.width)).toBeGreaterThanOrEqual(64);
    expect(px(picture.borderRadius)).toBeLessThanOrEqual(px(picture.width) / 2);
  });

  it("omits the shadow at 0", () => {
    expect(previewBackgroundStyle({ ...MAGENTA, shadow: 0 }, 960, 540).picture.boxShadow).toBe(
      undefined,
    );
  });

  it("is the export's rect: the picture is the same share of the stage as of a 1920×1080 output", () => {
    const stage = previewBackgroundStyle(MAGENTA, 800, 450).picture;
    const output = backgroundFrame(MAGENTA, 1920, 1080).picture;
    expect(px(stage.width) / 800).toBeCloseTo(output.width / 1920, 9);
    expect(px(stage.left) / 800).toBeCloseTo(output.x / 1920, 9);
    expect(px(stage.top) / 450).toBeCloseTo(output.y / 1080, 9);
  });
});
