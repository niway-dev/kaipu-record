import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PADDING_RANGE,
  RADIUS_RANGE,
  SHADOW_RANGE,
  BACKGROUND_IDS,
} from "../screenshots/beautify/backgrounds";
import {
  DEFAULT_BACKGROUND,
  backgroundFrame,
  hasBackground,
  parseBackground,
  type VideoBackground,
} from "./background";

const MAGENTA: VideoBackground = { bg: "magenta", padding: 48, radius: 16, shadow: 24 };

describe("parseBackground", () => {
  it("returns the default for an absent or non-object value", () => {
    expect(parseBackground(undefined)).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground(null)).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground("magenta")).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground(7)).toEqual(DEFAULT_BACKGROUND);
    expect(parseBackground([MAGENTA])).toEqual(DEFAULT_BACKGROUND);
  });

  it("the default is none with zeros, and a fresh object each call", () => {
    expect(DEFAULT_BACKGROUND).toEqual({ bg: "none", padding: 0, radius: 0, shadow: 0 });
    expect(parseBackground(undefined)).not.toBe(DEFAULT_BACKGROUND);
  });

  it("keeps a valid background as it is", () => {
    expect(parseBackground(MAGENTA)).toEqual(MAGENTA);
  });

  it("accepts every id the screenshot editor offers and falls back to none for any other", () => {
    for (const bg of BACKGROUND_IDS) expect(parseBackground({ bg }).bg).toBe(bg);
    expect(parseBackground({ ...MAGENTA, bg: "wallpaper" }).bg).toBe("none");
    expect(parseBackground({ ...MAGENTA, bg: 3 }).bg).toBe("none");
    expect(parseBackground({ ...MAGENTA, bg: null }).bg).toBe("none");
    expect(parseBackground({ padding: 10 }).bg).toBe("none");
  });

  it("clamps each number to the screenshot editor's range", () => {
    const high = parseBackground({ bg: "ocean", padding: 500, radius: 500, shadow: 500 });
    expect(high).toEqual({
      bg: "ocean",
      padding: PADDING_RANGE.max,
      radius: RADIUS_RANGE.max,
      shadow: SHADOW_RANGE.max,
    });
    const low = parseBackground({ bg: "ocean", padding: -3, radius: -3, shadow: -3 });
    expect(low).toEqual({
      bg: "ocean",
      padding: PADDING_RANGE.min,
      radius: RADIUS_RANGE.min,
      shadow: SHADOW_RANGE.min,
    });
  });

  it("turns non-finite and wrong-typed numbers into 0, never into a range edge", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, "48", null, undefined, {}, true]) {
      expect(parseBackground({ bg: "ocean", padding: bad, radius: bad, shadow: bad })).toEqual({
        bg: "ocean",
        padding: 0,
        radius: 0,
        shadow: 0,
      });
    }
  });

  it("ignores keys it does not know", () => {
    expect(parseBackground({ ...MAGENTA, wallpaper: "x.png" })).toEqual(MAGENTA);
  });
});

describe("hasBackground", () => {
  it("is true for any preset but none", () => {
    expect(hasBackground(MAGENTA)).toBe(true);
    expect(hasBackground({ bg: "dark", padding: 0, radius: 0, shadow: 0 })).toBe(true);
  });

  it("is false for none, even with stored padding, radius and shadow", () => {
    expect(hasBackground(DEFAULT_BACKGROUND)).toBe(false);
    expect(hasBackground({ bg: "none", padding: 48, radius: 16, shadow: 24 })).toBe(false);
  });
});

describe("backgroundFrame", () => {
  it("is the whole output, with no radius and no shadow, while the background is none", () => {
    const frame = backgroundFrame({ bg: "none", padding: 48, radius: 16, shadow: 24 }, 1920, 1080);
    expect(frame.box).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(frame.picture).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(frame.radius).toBe(0);
    expect(frame.shadow).toBeNull();
  });

  it("insets a 1920×1080 picture by 48 px, scale 1, keeping its aspect", () => {
    const { box, picture, radius, shadow } = backgroundFrame(MAGENTA, 1920, 1080);
    expect(box).toEqual({ x: 48, y: 48, width: 1824, height: 984 });
    // The shorter axis (height) takes the 48 px margin; the picture keeps 16:9, so the side
    // margins are wider than the top and bottom ones.
    expect(picture.height).toBeCloseTo(984, 6);
    expect(picture.width).toBeCloseTo((984 * 16) / 9, 6);
    expect(picture.x).toBeCloseTo((1920 - picture.width) / 2, 6);
    expect(picture.y).toBeCloseTo(48, 6);
    expect(picture.width / picture.height).toBeCloseTo(1920 / 1080, 9);
    expect(radius).toBe(16);
    expect(shadow).toEqual({ offsetY: 10.8, blur: 29.6, alpha: 0.24 });
  });

  it("scales padding, radius and shadow by height / 1080 at 2560×1440", () => {
    const { box, picture, radius, shadow } = backgroundFrame(MAGENTA, 2560, 1440);
    const k = 1440 / 1080;
    expect(box.x).toBeCloseTo(48 * k, 6);
    expect(box.y).toBeCloseTo(48 * k, 6);
    expect(radius).toBeCloseTo(16 * k, 6);
    expect(shadow?.offsetY).toBeCloseTo(10.8 * k, 6);
    expect(shadow?.blur).toBeCloseTo(29.6 * k, 6);
    // The shadow's darkness does not scale with size.
    expect(shadow?.alpha).toBe(0.24);
    // The same proportions as 1920×1080: the picture is the same share of the output.
    const small = backgroundFrame(MAGENTA, 1920, 1080).picture;
    expect(picture.width / 2560).toBeCloseTo(small.width / 1920, 9);
    expect(picture.height / 1440).toBeCloseTo(small.height / 1080, 9);
  });

  it("insets a portrait 1080×1920 canvas by the 1080-reference padding scaled to its height", () => {
    const { box, picture } = backgroundFrame(MAGENTA, 1080, 1920);
    const pad = 48 * (1920 / 1080);
    expect(box.x).toBeCloseTo(pad, 6);
    expect(box.y).toBeCloseTo(pad, 6);
    expect(box.width).toBeCloseTo(1080 - 2 * pad, 6);
    // Portrait: the width is the tight axis, so the picture fills the box's width.
    expect(picture.width).toBeCloseTo(1080 - 2 * pad, 6);
    expect(picture.x).toBeCloseTo(pad, 6);
    expect(picture.width / picture.height).toBeCloseTo(1080 / 1920, 9);
    expect(picture.y).toBeCloseTo((1920 - picture.height) / 2, 6);
  });

  it("insets a square 1080×1080 canvas evenly", () => {
    const { box, picture } = backgroundFrame(MAGENTA, 1080, 1080);
    expect(box).toEqual({ x: 48, y: 48, width: 984, height: 984 });
    expect(picture).toEqual({ x: 48, y: 48, width: 984, height: 984 });
  });

  it("with padding 0 the picture is the whole output but the radius and shadow still apply", () => {
    const frame = backgroundFrame({ bg: "ocean", padding: 0, radius: 16, shadow: 50 }, 1920, 1080);
    expect(frame.picture).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(frame.radius).toBe(16);
    expect(frame.shadow).not.toBeNull();
  });

  it("has no shadow at 0 and keeps the picture inside the output at the largest padding", () => {
    expect(backgroundFrame({ ...MAGENTA, shadow: 0 }, 1920, 1080).shadow).toBeNull();
    const max = backgroundFrame({ ...MAGENTA, padding: PADDING_RANGE.max }, 1920, 1080);
    expect(max.picture.x).toBeGreaterThan(0);
    expect(max.picture.y).toBeCloseTo(PADDING_RANGE.max, 6);
    expect(max.picture.x + max.picture.width).toBeLessThan(1920);
    expect(max.picture.y + max.picture.height).toBeLessThan(1080);
  });

  it("clamps out-of-range numbers it is handed directly", () => {
    const frame = backgroundFrame(
      { bg: "ocean", padding: 9999, radius: 9999, shadow: 9999 },
      1920,
      1080,
    );
    expect(frame.box.x).toBe(PADDING_RANGE.max);
    expect(frame.radius).toBe(RADIUS_RANGE.max);
  });
});

describe("backgroundFrame keeps the picture on the canvas at any output size (review C1)", () => {
  const WORST: VideoBackground = { bg: "magenta", padding: 96, radius: 28, shadow: 100 };
  const EPS = 1e-9;

  // A 128×2160 recording is valid. Its padding scaled by height / 1080 is 96 · 2 = 192 px on a
  // 128-px-wide output: the old geometry clamped the box to 1 px but left `picture.x` at 192,
  // outside the canvas, and the whole picture was lost (zero source pixels in the export).
  it.each([
    [128, 2160],
    [2160, 128],
    [64, 64],
    [1, 1],
    [16, 4000],
    [4000, 16],
    [1080, 3600],
  ])(
    "at %i×%i with padding 96, radius 28, shadow 100 the picture is non-empty, inside and centred",
    (width, height) => {
      const { picture, radius, shadow } = backgroundFrame(WORST, width, height);
      for (const n of [picture.x, picture.y, picture.width, picture.height, radius]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      expect(picture.width).toBeGreaterThan(0);
      expect(picture.height).toBeGreaterThan(0);
      expect(picture.x).toBeGreaterThanOrEqual(-EPS);
      expect(picture.y).toBeGreaterThanOrEqual(-EPS);
      expect(picture.x + picture.width).toBeLessThanOrEqual(width + EPS);
      expect(picture.y + picture.height).toBeLessThanOrEqual(height + EPS);
      // Centred on both axes.
      expect(picture.x + picture.width / 2).toBeCloseTo(width / 2, 9);
      expect(picture.y + picture.height / 2).toBeCloseTo(height / 2, 9);
      // The cap leaves at least half of the output on each axis, and keeps the output's aspect.
      expect(picture.width).toBeGreaterThanOrEqual(width / 2 - EPS);
      expect(picture.height).toBeGreaterThanOrEqual(height / 2 - EPS);
      expect(picture.width / picture.height).toBeCloseTo(width / height, 9);
      // The corner radius never exceeds half of the picture's smaller side.
      expect(radius).toBeGreaterThanOrEqual(0);
      expect(radius).toBeLessThanOrEqual(Math.min(picture.width, picture.height) / 2 + EPS);
      expect(shadow).not.toBeNull();
    },
  );

  it("caps each side's padding at 25 % of the smaller output dimension: exact rects", () => {
    expect(backgroundFrame(WORST, 128, 2160).picture).toEqual({
      x: 32,
      y: 540,
      width: 64,
      height: 1080,
    });
    expect(backgroundFrame(WORST, 128, 2160).box).toEqual({
      x: 32,
      y: 32,
      width: 64,
      height: 2096,
    });
    // At 1×1 the padding scales to 96 / 1080 px, below the cap (0.25 px): the picture is the
    // output inset by it, inside the canvas (the old 1 px floor on the box spilled it out).
    const tiny = backgroundFrame(WORST, 1, 1).picture;
    const pad = 96 / 1080;
    expect(tiny.x).toBeCloseTo(pad, 12);
    expect(tiny.width).toBeCloseTo(1 - 2 * pad, 12);
    // 64-px-wide and 16×4000: the cap binds at 16 px and 4 px.
    expect(backgroundFrame(WORST, 16, 4000).box).toEqual({ x: 4, y: 4, width: 8, height: 3992 });
  });

  it("caps the radius at half of the picture's smaller side (128×2160: 56 → 32)", () => {
    // 28 · (2160 / 1080) = 56 px of radius on a picture that is 64 px wide.
    expect(backgroundFrame(WORST, 128, 2160).radius).toBe(32);
    // Where it does not bind it is the scaled radius, untouched.
    expect(backgroundFrame(WORST, 1920, 1080).radius).toBe(28);
  });

  it("is continuous: no jump where the cap starts to bind", () => {
    // 128×2160 scales the padding by 2, so the cap (25 % of 128 = 32 px) binds at padding 16.
    const at = (padding: number) => backgroundFrame({ ...WORST, padding }, 128, 2160).picture;
    const below = at(16 - 1e-9);
    const above = at(16 + 1e-9);
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(below[key] - above[key])).toBeLessThan(1e-5);
    }
    // Past the cap the padding no longer moves the picture at all.
    expect(at(40)).toEqual(at(96));
    // And along the aspect: a 100-px-wide output from 250 to 320 px high crosses the binding
    // height (96 · h / 1080 = 25 at h = 281.25) without a step.
    let previous = backgroundFrame(WORST, 100, 250).picture;
    for (let height = 251; height <= 320; height++) {
      const next = backgroundFrame(WORST, 100, height).picture;
      expect(Math.abs(next.x - previous.x)).toBeLessThan(0.5);
      expect(Math.abs(next.width - previous.width)).toBeLessThan(0.5);
      previous = next;
    }
  });

  it("never returns NaN for an output with no size", () => {
    for (const [w, h] of [
      [0, 0],
      [0, 100],
      [100, 0],
    ] as const) {
      const frame = backgroundFrame(WORST, w, h);
      for (const n of [
        frame.picture.x,
        frame.picture.y,
        frame.picture.width,
        frame.picture.height,
      ]) {
        expect(Number.isNaN(n)).toBe(false);
      }
    }
  });
});

describe("backgroundFrame is unchanged at every ordinary output size (review C1)", () => {
  const PICTURE = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
  });

  // Frozen from the geometry before the cap: these are the numbers the Proof measured in the
  // real app (Balanced 1280×720 → picture x 57–1222, y 32–687; Vertical 1080×1920 → x 85–993).
  it.each([
    [1920, 1080, 48, PICTURE(85.33333333333337, 48, 1749.3333333333333, 984), 28],
    [
      1080,
      1920,
      48,
      PICTURE(85.33333333333333, 151.70370370370364, 909.3333333333334, 1616.5925925925926),
      49.77777777777777,
    ],
    [1080, 1080, 48, PICTURE(48, 48, 984, 984), 28],
    [2560, 1440, 48, PICTURE(113.77777777777783, 64, 2332.4444444444443, 1312), 37.33333333333333],
    [1280, 720, 48, PICTURE(56.888888888888914, 32, 1166.2222222222222, 656), 18.666666666666664],
    [640, 360, 48, PICTURE(28.444444444444457, 16, 583.1111111111111, 328), 9.333333333333332],
    [1920, 1080, 96, PICTURE(170.66666666666674, 96, 1578.6666666666665, 888), 28],
    [
      1080,
      1920,
      96,
      PICTURE(170.66666666666666, 303.4074074074074, 738.6666666666667, 1313.1851851851852),
      49.77777777777777,
    ],
    [1280, 720, 96, PICTURE(113.77777777777783, 64, 1052.4444444444443, 592), 18.666666666666664],
    [2560, 1440, 96, PICTURE(227.55555555555566, 128, 2104.8888888888887, 1184), 37.33333333333333],
    [1080, 1080, 96, PICTURE(96, 96, 888, 888), 28],
  ])("%i×%i at padding %i is exactly the frozen rect", (w, h, padding, picture, radius) => {
    const frame = backgroundFrame({ bg: "magenta", padding, radius: 28, shadow: 100 }, w, h);
    expect(frame.picture).toEqual(picture);
    expect(frame.radius).toBe(radius);
  });

  it("freezes the box and the shadow too (1920×1080 and 1080×1920 at 48, 1280×720 at 96)", () => {
    const b = (padding: number, w: number, h: number) =>
      backgroundFrame({ bg: "magenta", padding, radius: 28, shadow: 100 }, w, h);
    expect(b(48, 1920, 1080).box).toEqual({ x: 48, y: 48, width: 1824, height: 984 });
    expect(b(48, 1920, 1080).shadow).toEqual({ offsetY: 45, blur: 98, alpha: 0.62 });
    expect(b(48, 1080, 1920).box).toEqual({
      x: 85.33333333333333,
      y: 85.33333333333333,
      width: 909.3333333333334,
      height: 1749.3333333333333,
    });
    expect(b(48, 1080, 1920).shadow).toEqual({ offsetY: 80, blur: 174.2222222222222, alpha: 0.62 });
    expect(b(96, 1280, 720).box).toEqual({ x: 64, y: 64, width: 1152, height: 592 });
  });

  // The geometry before the cap, verbatim: box.width/height clamped to 1 px, no radius cap.
  function legacyFrame(background: VideoBackground, width: number, height: number) {
    const scale = height / 1080;
    const padding = Math.min(PADDING_RANGE.max, Math.max(0, background.padding)) * scale;
    const box = {
      x: padding,
      y: padding,
      width: Math.max(1, width - 2 * padding),
      height: Math.max(1, height - 2 * padding),
    };
    const fit = Math.min(box.width / width, box.height / height);
    return {
      box,
      picture: {
        x: box.x + (box.width - width * fit) / 2,
        y: box.y + (box.height - height * fit) / 2,
        width: width * fit,
        height: height * fit,
      },
      radius: Math.min(RADIUS_RANGE.max, Math.max(0, background.radius)) * scale,
    };
  }

  it("matches the geometry before the cap for every output no taller than 1 : 2.8, any padding and radius", () => {
    // The cap binds only when 96 · h / 1080 > 25 % of the smaller side, i.e. h / w > 2.8125:
    // 9:16 is 1.78, so no preset or source-shaped output reaches it.
    const widths = [320, 640, 720, 1080, 1280, 1920, 2560, 3840];
    const heights = [180, 360, 540, 720, 1080, 1440, 1920, 2160];
    let checked = 0;
    for (const width of widths) {
      for (const height of heights) {
        if (height > 2.8 * width) continue;
        for (const padding of [0, 1, 7, 24, 48, 63.5, 96]) {
          for (const radius of [0, 14, 28]) {
            const background: VideoBackground = { bg: "ocean", padding, radius, shadow: 40 };
            const now = backgroundFrame(background, width, height);
            const before = legacyFrame(background, width, height);
            expect(
              { box: now.box, picture: now.picture, radius: now.radius },
              `${width}×${height} p${padding} r${radius}`,
            ).toEqual(before);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("background.ts stays worker-safe", () => {
  // The export worker bundles this module and the screenshot editor's table it reads
  // (spec decision 12). Neither may import React or touch the DOM at module scope, or the
  // preload-style failure of ADR 0038's bundle rule returns: a worker that cannot load.
  const files = [
    resolve(__dirname, "background.ts"),
    resolve(__dirname, "../screenshots/beautify/backgrounds.ts"),
  ];
  it.each(files)("%s has no React, DOM or non-relative import", (file) => {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)];
    for (const [, specifier] of imports) {
      expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.{1,2}\//);
      expect(specifier).not.toMatch(/react|beautified-frame|beautify-panel|\.css/);
    }
    expect(source).not.toMatch(/\bdocument\./);
    expect(source).not.toMatch(/\bwindow\./);
  });
});
