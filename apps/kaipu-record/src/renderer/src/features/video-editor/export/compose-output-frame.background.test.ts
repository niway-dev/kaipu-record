// The background as the composer's outermost step (NIW2-668, ADR 0051), looked at in PIXELS:
// a software canvas (test/soft-canvas.ts) stands in for OffscreenCanvas, so every assertion
// below samples real pixels of the finished frame. It checks where the composer puts the
// picture and in what order — its logic — not Skia's anti-aliasing; the real-browser numbers
// are in the PR's Proof table.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solidCanvas, SoftCanvas, SoftContext, type Rgba } from "../../../test/soft-canvas";
import { backgroundPaint } from "../../screenshots/beautify/backgrounds";
import { backgroundFrame, type VideoBackground } from "../background";
import type { Redaction } from "../privacy/redaction";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { CameraPathMessage } from "./export-messages";
import { createOutputComposer, type OutputComposerOptions } from "./compose-output-frame";

let made = 0;
class CountingCanvas extends SoftCanvas {
  constructor(width: number, height: number) {
    super(width, height);
    made++;
  }
}
beforeEach(() => {
  made = 0;
  vi.stubGlobal("OffscreenCanvas", CountingCanvas);
});
afterEach(() => vi.unstubAllGlobals());

const GREEN = "#00ff00";
const MAGENTA: VideoBackground = { bg: "magenta", padding: 48, radius: 16, shadow: 24 };
const SRC = { width: 960, height: 540 };

const near = (actual: Rgba, expected: Rgba, tolerance = 3): void => {
  for (let c = 0; c < 4; c++)
    expect(Math.abs(actual[c]! - expected[c]!)).toBeLessThanOrEqual(tolerance);
};

/** The background's colour at a pixel of a w×h output: the CSS 135° gradient, from → to. */
function gradientAt(id: VideoBackground["bg"], w: number, h: number, x: number, y: number): Rgba {
  const paint = backgroundPaint(id);
  if (paint.kind !== "gradient") throw new Error("test needs a gradient preset");
  const t = (x + 0.5 + (y + 0.5)) / (w + h);
  const hex = (s: string): Rgba => [
    parseInt(s.slice(1, 3), 16),
    parseInt(s.slice(3, 5), 16),
    parseInt(s.slice(5, 7), 16),
    255,
  ];
  const a = hex(paint.from);
  const b = hex(paint.to);
  return a.map((v, c) => v + (b[c]! - v) * t) as Rgba;
}

function camera(scale: number): CameraPathMessage {
  const n = 300;
  return {
    fps: 30,
    cx: new Float32Array(n).fill(0.5),
    cy: new Float32Array(n).fill(0.5),
    scale: new Float32Array(n).fill(scale),
  };
}

const cover: Redaction = {
  id: "r",
  kind: "cover",
  start: 0,
  end: 10,
  rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
  fill: "#0000ff",
  label: "",
};

interface RunOptions extends Partial<OutputComposerOptions> {
  /** The decoded frame (source size); a flat green by default. */
  frame?: SoftCanvas;
  webcamFrame?: boolean;
}

/** One composed frame onto a fresh output canvas; returns that canvas. */
function run(out: { width: number; height: number }, options: RunOptions = {}): SoftCanvas {
  const output = new SoftCanvas(out.width, out.height);
  const { frame, webcamFrame, ...rest } = options;
  const compose = createOutputComposer({
    ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
    width: out.width,
    height: out.height,
    camera: null,
    redactions: [],
    overlayWindows: [],
    overlayBitmaps: new Map(),
    ...rest,
  });
  const image = frame ?? solidCanvas(out.width, out.height, GREEN);
  compose.clip(
    image as unknown as CanvasImageSource,
    0,
    1 / 30,
    0,
    webcamFrame
      ? {
          image: {
            image: solidCanvas(64, 64, "#ffff00") as unknown as CanvasImageSource,
            width: 64,
            height: 64,
          },
          sourceTs: 0,
        }
      : null,
  );
  return output;
}

/** The frame with a red 100×100 square in its top-left corner, to see what a crop shows. */
function frameWithRedCorner(): SoftCanvas {
  const frame = solidCanvas(SRC.width, SRC.height, GREEN);
  const ctx = frame.getContext();
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 100, 100);
  return frame;
}

/** The picture's rect exactly as the composer snaps it to whole pixels. */
function snapped(frame: ReturnType<typeof backgroundFrame>): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { x, y, width, height } = frame.picture;
  return {
    left: Math.round(x),
    top: Math.round(y),
    right: Math.round(x + width),
    bottom: Math.round(y + height),
  };
}

describe("a plain scene composes exactly as before", () => {
  // This compares the composer with ITSELF (absent vs `none` vs `none` + numbers): it proves the
  // background option is inert for `none`, not that the plain path is unchanged. That one is
  // compose-output-frame.plain-pin.test.ts, pinned to hashes captured from the base code.
  it("is byte-identical with no background, with none, and with none + stored numbers", () => {
    const frame = frameWithRedCorner();
    const plain = run(SRC, { frame, camera: camera(2) });
    const none = run(SRC, {
      frame,
      camera: camera(2),
      background: { bg: "none", padding: 0, radius: 0, shadow: 0 },
    });
    const stored = run(SRC, {
      frame,
      camera: camera(2),
      background: { bg: "none", padding: 48, radius: 16, shadow: 24 },
    });
    expect(Buffer.from(none.data).equals(Buffer.from(plain.data))).toBe(true);
    expect(Buffer.from(stored.data).equals(Buffer.from(plain.data))).toBe(true);
  });

  it("allocates no picture canvas when nothing is drawn around it", () => {
    run(SRC);
    const plain = made;
    made = 0;
    run(SRC, { background: { bg: "none", padding: 48, radius: 16, shadow: 24 } });
    expect(made).toBe(plain);
    made = 0;
    run(SRC, { background: MAGENTA });
    expect(made).toBeGreaterThan(plain);
  });
});

describe("a background on an output that matches the source (Balanced, Light, Maximum, GIF)", () => {
  const frame = backgroundFrame(MAGENTA, SRC.width, SRC.height);
  const pic = snapped(frame);

  it("keeps the output size and fills every corner with the background's gradient", () => {
    const out = run(SRC, { background: MAGENTA });
    expect([out.width, out.height]).toEqual([SRC.width, SRC.height]);
    for (const [x, y] of [
      [0, 0],
      [SRC.width - 1, 0],
      [0, SRC.height - 1],
      [SRC.width - 1, SRC.height - 1],
    ] as const) {
      near(out.pixel(x, y), gradientAt("magenta", SRC.width, SRC.height, x, y));
    }
    // The ends of the gradient are the preset's two colours (#ff2d6e → #a3044a).
    near(out.pixel(0, 0), [255, 45, 110, 255], 4);
    near(out.pixel(SRC.width - 1, SRC.height - 1), [163, 4, 74, 255], 4);
  });

  it("insets the picture: its centre is the plain composition, its box edge is where backgroundFrame says", () => {
    const out = run(SRC, { background: MAGENTA });
    const plain = run(SRC);
    near(out.pixel(480, 270), plain.pixel(480, 270), 0);
    expect(out.pixel(480, 270)).toEqual([0, 255, 0, 255]);
    // The first and last whole pixels inside the snapped picture are the picture; the ones
    // just outside are not (they are the background, possibly under the shadow).
    const mid = Math.round((pic.top + pic.bottom) / 2);
    const row = Math.round((pic.left + pic.right) / 2);
    expect(out.pixel(pic.left + 1, mid)).toEqual([0, 255, 0, 255]);
    expect(out.pixel(pic.right - 2, mid)).toEqual([0, 255, 0, 255]);
    expect(out.pixel(row, pic.top + 1)).toEqual([0, 255, 0, 255]);
    expect(out.pixel(row, pic.bottom - 2)).toEqual([0, 255, 0, 255]);
    expect(out.pixel(pic.left - 2, mid)[1]).toBeLessThan(120);
    expect(out.pixel(pic.right + 1, mid)[1]).toBeLessThan(120);
    expect(out.pixel(row, pic.top - 2)[1]).toBeLessThan(120);
    expect(out.pixel(row, pic.bottom + 1)[1]).toBeLessThan(120);
    // 48 px at 1080 → 24 px at 540: the top margin, and the picture keeps its 16:9 aspect.
    expect(pic.top).toBe(24);
    expect(pic.bottom).toBe(516);
    expect((pic.right - pic.left) / (pic.bottom - pic.top)).toBeCloseTo(16 / 9, 2);
  });

  it("darkens the background just outside the picture with the shadow, more below than above", () => {
    const out = run(SRC, { background: MAGENTA });
    const bare = run(SRC, { background: { ...MAGENTA, shadow: 0 } });
    const x = Math.round((pic.left + pic.right) / 2);
    const below = out.pixel(x, pic.bottom + 2);
    const belowBare = bare.pixel(x, pic.bottom + 2);
    const above = out.pixel(x, pic.top - 3);
    const aboveBare = bare.pixel(x, pic.top - 3);
    // Darker on every colour channel that has something to lose, and the shadow is offset down.
    expect(below[0]).toBeLessThan(belowBare[0] - 8);
    expect(above[0]).toBeLessThan(aboveBare[0]);
    expect(belowBare[0] - below[0]).toBeGreaterThan(aboveBare[0] - above[0]);
    // Far from the picture nothing changes: the corners are the plain gradient.
    near(out.pixel(0, SRC.height - 1), bare.pixel(0, SRC.height - 1), 1);
    // And without a shadow slider the background just outside is the plain gradient.
    near(belowBare, gradientAt("magenta", SRC.width, SRC.height, x, pic.bottom + 2), 3);
  });

  it("rounds the picture's corners with the radius: the corner pixel shows the background", () => {
    const rounded = run(SRC, { background: MAGENTA });
    const square = run(SRC, { background: { ...MAGENTA, radius: 0 } });
    // The corner pixel is outside the 8 px (16 at 1080) radius…
    expect(rounded.pixel(pic.left, pic.top)[1]).toBeLessThan(120);
    expect(square.pixel(pic.left, pic.top)).toEqual([0, 255, 0, 255]);
    // …and a pixel one radius in along both axes is picture.
    expect(rounded.pixel(pic.left + 8, pic.top + 8)).toEqual([0, 255, 0, 255]);
    // Every corner, not only the first.
    expect(rounded.pixel(pic.right - 1, pic.top)[1]).toBeLessThan(120);
    expect(rounded.pixel(pic.left, pic.bottom - 1)[1]).toBeLessThan(120);
    expect(rounded.pixel(pic.right - 1, pic.bottom - 1)[1]).toBeLessThan(120);
  });

  it("paints a solid preset flat", () => {
    const out = run(SRC, { background: { bg: "dark", padding: 48, radius: 0, shadow: 0 } });
    expect(out.pixel(0, 0)).toEqual([15, 15, 17, 255]);
    expect(out.pixel(SRC.width - 1, SRC.height - 1)).toEqual([15, 15, 17, 255]);
  });

  it("does not zoom the padding: a 2× zoom changes the picture and not a pixel of the background", () => {
    const withRedCorner = frameWithRedCorner();
    const still = run(SRC, { frame: withRedCorner, background: MAGENTA });
    const zoomed = run(SRC, { frame: withRedCorner, background: MAGENTA, camera: camera(2) });
    // Un-zoomed, the picture's top-left shows the red square; zoomed 2× on the centre it does not.
    expect(still.pixel(pic.left + 20, pic.top + 14)).toEqual([255, 0, 0, 255]);
    expect(zoomed.pixel(pic.left + 20, pic.top + 14)).toEqual([0, 255, 0, 255]);
    // Every pixel in the margin (outside the picture and its shadow's reach) is identical.
    for (const [x, y] of [
      [0, 0],
      [SRC.width - 1, 0],
      [0, SRC.height - 1],
      [SRC.width - 1, SRC.height - 1],
      [5, 270],
      [SRC.width - 6, 270],
      [480, 4],
    ] as const) {
      expect(zoomed.pixel(x, y)).toEqual(still.pixel(x, y));
    }
    near(zoomed.pixel(0, 0), gradientAt("magenta", SRC.width, SRC.height, 0, 0));
  });

  it("keeps a privacy region inside the picture, at the picture's corner and not the output's", () => {
    const out = run(SRC, { background: MAGENTA, redactions: [cover] });
    expect(out.pixel(pic.left + 20, pic.top + 14)).toEqual([0, 0, 255, 255]);
    // The cover would reach the output's own top-left if it were composed after the background.
    expect(out.pixel(5, 5)).not.toEqual([0, 0, 255, 255]);
    near(out.pixel(5, 5), gradientAt("magenta", SRC.width, SRC.height, 5, 5));
  });

  it("composes the webcam inside the picture: no webcam pixel in the padding, some in the picture", () => {
    const webcam: WebcamScene = {
      layout: { ...WEBCAM_DEFAULTS, shape: "circle", shadow: false, mirrored: false },
      segments: [],
    };
    const out = run(SRC, { background: MAGENTA, webcam, webcamFrame: true });
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const [r, g, b] = out.pixel(x, y);
        if (r > 200 && g > 200 && b < 80) {
          if (x >= pic.left && x < pic.right && y >= pic.top && y < pic.bottom) inside++;
          else outside++;
        }
      }
    }
    expect(inside).toBeGreaterThan(200);
    expect(outside).toBe(0);
    // The layer is part of the picture: it shrinks with it (the picture is 0.911 of the output
    // at padding 48), so the bubble is smaller than without a background, not the same size.
    const plain = run(SRC, { webcam, webcamFrame: true });
    let plainCount = 0;
    for (let y = 0; y < plain.height; y++) {
      for (let x = 0; x < plain.width; x++) {
        const [r, g, b] = plain.pixel(x, y);
        if (r > 200 && g > 200 && b < 80) plainCount++;
      }
    }
    const fit = backgroundFrame(MAGENTA, SRC.width, SRC.height).picture.height / SRC.height;
    expect(inside / plainCount).toBeGreaterThan(fit * fit * 0.9);
    expect(inside / plainCount).toBeLessThan(fit * fit * 1.1);
  });

  it("paints a slide's frame the same way", () => {
    const output = new SoftCanvas(SRC.width, SRC.height);
    const compose = createOutputComposer({
      ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
      width: SRC.width,
      height: SRC.height,
      camera: null,
      redactions: [],
      overlayWindows: [],
      overlayBitmaps: new Map(),
      background: MAGENTA,
    });
    compose.slide(solidCanvas(960, 540, "#ffffff") as unknown as ImageBitmap, 0);
    expect(output.pixel(480, 270)).toEqual([255, 255, 255, 255]);
    near(output.pixel(0, 0), [255, 45, 110, 255], 4);
  });
});

describe("a background on a fixed-canvas preset (Vertical, Square)", () => {
  /** A framed composition: `view` is the source-size canvas the composer draws on. */
  function runFramed(
    target: { width: number; height: number },
    mode: "fit" | "fill",
    padding: "black" | "blur",
    background?: VideoBackground,
    extra: RunOptions = {},
  ): SoftCanvas {
    const output = new SoftCanvas(target.width, target.height);
    const view = new SoftCanvas(SRC.width, SRC.height);
    const compose = createOutputComposer({
      ctx: view.getContext() as unknown as OffscreenCanvasRenderingContext2D,
      width: SRC.width,
      height: SRC.height,
      camera: null,
      redactions: [],
      overlayWindows: [],
      overlayBitmaps: new Map(),
      framing: {
        view: view as unknown as OffscreenCanvas,
        ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
        width: target.width,
        height: target.height,
        mode,
        padding,
      },
      background,
      ...extra,
    });
    compose.clip(
      solidCanvas(SRC.width, SRC.height, GREEN) as unknown as CanvasImageSource,
      0,
      1 / 30,
      0,
      null,
    );
    return output;
  }

  const VERTICAL = { width: 540, height: 960 };
  const SQUARE = { width: 540, height: 540 };

  it("paints the background in the letterbox instead of black, and frames the picture inside the padding", () => {
    const out = runFramed(VERTICAL, "fit", "black", MAGENTA);
    expect([out.width, out.height]).toEqual([540, 960]);
    // The letterbox above and below the 16:9 picture is the gradient, not black.
    near(out.pixel(270, 100), gradientAt("magenta", 540, 960, 270, 100));
    near(out.pixel(270, 860), gradientAt("magenta", 540, 960, 270, 860));
    near(out.pixel(0, 0), [255, 45, 110, 255], 4);
    // The picture is centred, one padding in from the sides, and is the frame's green.
    expect(out.pixel(270, 480)).toEqual([0, 255, 0, 255]);
    expect(out.pixel(2, 480)[1]).toBeLessThan(120);
    expect(out.pixel(538, 480)[1]).toBeLessThan(120);
  });

  it("paints it over the blurred letterbox too", () => {
    const out = runFramed(VERTICAL, "fit", "blur", MAGENTA);
    near(out.pixel(270, 100), gradientAt("magenta", 540, 960, 270, 100));
  });

  it("fills the inset box in Fill mode, with the background around it", () => {
    const out = runFramed(SQUARE, "fill", "black", MAGENTA);
    near(out.pixel(0, 0), [255, 45, 110, 255], 4);
    near(out.pixel(539, 539), [163, 4, 74, 255], 4);
    expect(out.pixel(270, 270)).toEqual([0, 255, 0, 255]);
    // One padding in (48 at 1080 → 24 at 540) the picture starts.
    expect(out.pixel(30, 270)).toEqual([0, 255, 0, 255]);
    expect(out.pixel(20, 270)[1]).toBeLessThan(120);
  });

  it("rounds the framed picture's own corners, not the canvas's", () => {
    const out = runFramed(VERTICAL, "fit", "black", MAGENTA);
    const { box } = backgroundFrame(MAGENTA, 540, 960);
    const w = Math.round(box.x + box.width) - Math.round(box.x);
    const h = Math.round((w * SRC.height) / SRC.width);
    const left = Math.round(box.x);
    const top = Math.round(480 - h / 2);
    // The picture's top-left pixel is the background (inside the radius), not green…
    expect(out.pixel(left, top)[1]).toBeLessThan(120);
    // …and a pixel one radius in is the picture.
    const radius = Math.round(backgroundFrame(MAGENTA, 540, 960).radius);
    expect(out.pixel(left + radius, top + radius)).toEqual([0, 255, 0, 255]);
  });

  it("keeps the letterbox black, byte for byte, when there is no background", () => {
    const plain = runFramed(VERTICAL, "fit", "black");
    const none = runFramed(VERTICAL, "fit", "black", {
      bg: "none",
      padding: 48,
      radius: 16,
      shadow: 24,
    });
    expect(Buffer.from(none.data).equals(Buffer.from(plain.data))).toBe(true);
    expect(plain.pixel(270, 100)).toEqual([0, 0, 0, 255]);
    expect(plain.pixel(0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("does not zoom the padding on a Vertical export either", () => {
    const still = runFramed(VERTICAL, "fit", "black", MAGENTA, { camera: undefined });
    const zoomed = runFramed(VERTICAL, "fit", "black", MAGENTA, { camera: camera(2) });
    for (const [x, y] of [
      [0, 0],
      [539, 0],
      [0, 959],
      [539, 959],
      [270, 100],
    ] as const) {
      expect(zoomed.pixel(x, y)).toEqual(still.pixel(x, y));
    }
  });
});

describe("a background on an extreme output keeps the picture on the canvas (review C1)", () => {
  const WORST: VideoBackground = { bg: "magenta", padding: 96, radius: 28, shadow: 100 };

  /** Every pixel that is the source's flat green, and where the box of them lies. */
  function greenBox(out: SoftCanvas): {
    count: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    let count = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const [r, g, b] = out.pixel(x, y);
        if (r === 0 && g === 255 && b === 0) {
          count++;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return { count, left, top, right, bottom };
  }

  // 128×2160 is a valid recording (a tall, narrow capture). Scaled by height / 1080 the 96-px
  // padding is 192 px on a 128-px-wide output: the picture used to land entirely outside it.
  it.each([
    [128, 2160],
    [2160, 128],
    [64, 64],
  ])(
    "%i×%i with padding 96 draws the source's colour at the centre and inside the canvas",
    (width, height) => {
      const out = run({ width, height }, { background: WORST });
      expect(out.pixel(Math.floor(width / 2), Math.floor(height / 2))).toEqual([0, 255, 0, 255]);
      const found = greenBox(out);
      expect(found.count).toBeGreaterThan(0);
      // The picture is at least half of the output on each axis and centred on it.
      expect(found.right - found.left + 1).toBeGreaterThanOrEqual(width / 2 - 2);
      expect(found.bottom - found.top + 1).toBeGreaterThanOrEqual(height / 2 - 2);
      expect((found.left + found.right + 1) / 2).toBeCloseTo(width / 2, 0);
      expect((found.top + found.bottom + 1) / 2).toBeCloseTo(height / 2, 0);
      // And the padding is the background, not the picture.
      near(out.pixel(0, 0), [255, 45, 110, 255], 4);
    },
  );

  it("a 1×1 output keeps its single pixel as the picture", () => {
    const out = run({ width: 1, height: 1 }, { background: WORST });
    expect(out.pixel(0, 0)).toEqual([0, 255, 0, 255]);
  });

  it("a fixed-canvas preset onto 128×2160 keeps the framed picture on the canvas", () => {
    const target = { width: 128, height: 2160 };
    const output = new SoftCanvas(target.width, target.height);
    const view = new SoftCanvas(SRC.width, SRC.height);
    const compose = createOutputComposer({
      ctx: view.getContext() as unknown as OffscreenCanvasRenderingContext2D,
      width: SRC.width,
      height: SRC.height,
      camera: null,
      redactions: [],
      overlayWindows: [],
      overlayBitmaps: new Map(),
      framing: {
        view: view as unknown as OffscreenCanvas,
        ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
        width: target.width,
        height: target.height,
        mode: "fit",
        padding: "black",
      },
      background: WORST,
    });
    compose.clip(
      solidCanvas(SRC.width, SRC.height, GREEN) as unknown as CanvasImageSource,
      0,
      1 / 30,
      0,
      null,
    );
    expect(output.pixel(64, 1080)).toEqual([0, 255, 0, 255]);
    expect(greenBox(output).count).toBeGreaterThan(0);
  });

  it("an ordinary size draws the very same picture as before the cap: 1920×1080 at padding 96", () => {
    const out = run({ width: 1920, height: 1080 }, { background: { ...WORST, shadow: 0 } });
    const found = greenBox(out);
    // x 171–1748, y 96–983: backgroundFrame's frozen rect (170.67, 96, 1578.67 × 888) snapped.
    expect([found.left, found.top, found.right, found.bottom].map((n) => Math.abs(n))).toEqual(
      expect.arrayContaining([96]),
    );
    expect(found.top).toBe(96);
    expect(found.bottom).toBe(983);
    expect(found.left).toBeGreaterThanOrEqual(170);
    expect(found.left).toBeLessThanOrEqual(173);
  });
});

describe("the static background layer is built once, not once per frame (review S2)", () => {
  // The paint and the shadow are identical in every frame of an export, and a full-output
  // gradient plus a full-picture Gaussian blur on every frame cost 15 ms per 1080p frame on a
  // software canvas. They are rendered once per (output size, background, picture rect) onto a
  // cached canvas that each frame blits. A new composer — a changed size or background — has a
  // new cache by construction.
  const FRAMES = 30;
  // A failed assertion must not leave a spy behind to inflate the next test's counts.
  afterEach(() => vi.restoreAllMocks());

  interface Live {
    compose: ReturnType<typeof createOutputComposer>;
    output: SoftCanvas;
  }
  /** A composer that lives across frames, as it does in an export. */
  function live(
    out: { width: number; height: number },
    background: VideoBackground | null,
    framing?: { target: { width: number; height: number }; mode: "fit" | "fill" },
  ): Live {
    const output = new SoftCanvas(
      framing ? framing.target.width : out.width,
      framing ? framing.target.height : out.height,
    );
    const view = framing ? new SoftCanvas(out.width, out.height) : null;
    const compose = createOutputComposer({
      ctx: (view ?? output).getContext() as unknown as OffscreenCanvasRenderingContext2D,
      width: out.width,
      height: out.height,
      camera: null,
      redactions: [],
      overlayWindows: [],
      overlayBitmaps: new Map(),
      framing: framing
        ? {
            view: view as unknown as OffscreenCanvas,
            ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
            width: framing.target.width,
            height: framing.target.height,
            mode: framing.mode,
            padding: "black",
          }
        : null,
      background,
    });
    return { compose, output };
  }
  const clip = (l: Live, frame: SoftCanvas, i: number): void =>
    l.compose.clip(frame as unknown as CanvasImageSource, i / 30, 1 / 30, i / 30, null);

  it("fills the gradient and draws the shadow once over a whole run of frames", () => {
    const gradient = vi.spyOn(SoftContext.prototype, "createLinearGradient");
    const shadowCaster = vi.spyOn(SoftContext.prototype, "fill");
    const l = live(SRC, MAGENTA);
    const frame = solidCanvas(SRC.width, SRC.height, GREEN);
    for (let i = 0; i < FRAMES; i++) clip(l, frame, i);
    expect(gradient).toHaveBeenCalledTimes(1);
    expect(shadowCaster).toHaveBeenCalledTimes(1);
  });

  it("allocates one more canvas for the layer, once, and none per frame", () => {
    const plainRun = live(SRC, null);
    const frame = solidCanvas(SRC.width, SRC.height, GREEN);
    clip(plainRun, frame, 0);
    const plain = made;
    made = 0;
    const l = live(SRC, MAGENTA);
    clip(l, frame, 0);
    const first = made;
    for (let i = 1; i < FRAMES; i++) clip(l, frame, i);
    expect(made).toBe(first);
    // Only `new OffscreenCanvas` calls are counted: the composer's picture canvas and its cached
    // background layer. The output the test makes is a direct `SoftCanvas` and is not counted.
    expect(first).toBeGreaterThan(plain);
  });

  it("a plain scene never builds it, whatever the stored numbers", () => {
    const gradient = vi.spyOn(SoftContext.prototype, "createLinearGradient");
    const frame = solidCanvas(SRC.width, SRC.height, GREEN);
    // What a composer with no background allocates at creation and per frame…
    made = 0;
    const plain = live(SRC, null);
    clip(plain, frame, 0);
    const plainTotal = made;
    // …is exactly what one with `none` + stored numbers does, over any number of frames.
    made = 0;
    const l = live(SRC, { bg: "none", padding: 48, radius: 16, shadow: 24 });
    for (let i = 0; i < 5; i++) clip(l, frame, i);
    expect(made).toBe(plainTotal);
    expect(gradient).not.toHaveBeenCalled();
  });

  it("every frame is byte-identical to the same frame from a fresh composer", () => {
    const l = live(SRC, MAGENTA);
    for (let i = 0; i < 8; i++) {
      // A different picture each frame: a red square that moves, so a stale layer or a leaked
      // pixel from the previous frame cannot hide.
      const frame = solidCanvas(SRC.width, SRC.height, GREEN);
      const fctx = frame.getContext();
      fctx.fillStyle = "#ff0000";
      fctx.fillRect(40 * i, 30 * i, 100, 100);
      clip(l, frame, i);
      const fresh = live(SRC, MAGENTA);
      clip(fresh, frame, 0);
      expect(Buffer.from(l.output.data).equals(Buffer.from(fresh.output.data)), `frame ${i}`).toBe(
        true,
      );
    }
  });

  it("keeps one layer per picture rect: Fit slides and Fill clips alternate without rebuilding", () => {
    const gradient = vi.spyOn(SoftContext.prototype, "createLinearGradient");
    const l = live(SRC, MAGENTA, { target: { width: 540, height: 540 }, mode: "fill" });
    const frame = solidCanvas(SRC.width, SRC.height, GREEN);
    for (let i = 0; i < 6; i++) {
      clip(l, frame, i);
      l.compose.slide(solidCanvas(960, 540, "#ffffff") as unknown as ImageBitmap, i / 30);
    }
    // One layer for the Fill card, one for the Fit card (slides are always Fit).
    expect(gradient).toHaveBeenCalledTimes(2);
  });

  it("a new composer with another background paints it: nothing is shared between composers", () => {
    const frame = solidCanvas(SRC.width, SRC.height, GREEN);
    const a = live(SRC, MAGENTA);
    clip(a, frame, 0);
    const b = live(SRC, { ...MAGENTA, bg: "ocean" });
    clip(b, frame, 0);
    near(a.output.pixel(0, 0), [255, 45, 110, 255], 4);
    near(b.output.pixel(0, 0), [37, 99, 235, 255], 4); // #2563eb
    // A different padding moves the picture, so the shadow under it moves with it.
    const c = live(SRC, { ...MAGENTA, padding: 96 });
    clip(c, frame, 0);
    const wide = backgroundFrame({ ...MAGENTA, padding: 96 }, SRC.width, SRC.height).picture;
    expect(
      c.output.pixel(Math.round(wide.x) - 1, Math.round(wide.y + wide.height / 2))[1],
    ).toBeLessThan(120);
  });
});

describe("the workers hand the plan's background to the composer", () => {
  const read = (file: string): string => readFileSync(path.join(__dirname, file), "utf8");

  it.each(["export-worker.ts", "gif-worker.ts"])("%s passes plan.background", (file) => {
    expect(read(file)).toMatch(/background:\s*plan\.background/);
  });

  it("the GIF worker composes onto the source-size canvas it then downsamples", () => {
    // The GIF path is the same composer on `full` (source size); `grab()` only downscales.
    const source = read("gif-worker.ts");
    expect(source).toMatch(/createOutputComposer\(\{\s*ctx: fullCtx/);
    expect(source).toMatch(/smallCtx\.drawImage\(full, 0, 0, output\.width, output\.height\)/);
  });
});

describe("a GIF frame carries the background", () => {
  it("a source-size composition with a background has the gradient in its corners, which a downscale keeps", () => {
    // What gif-worker does: compose onto `full`, then draw it smaller. The corner survives.
    const full = run(SRC, { background: MAGENTA });
    const small = new SoftCanvas(480, 270);
    small
      .getContext()
      .drawImage(full as unknown as SoftCanvas, 0, 0, SRC.width, SRC.height, 0, 0, 480, 270);
    near(small.pixel(0, 0), [255, 45, 110, 255], 4);
    near(small.pixel(479, 269), [163, 4, 74, 255], 4);
    expect(small.pixel(240, 135)).toEqual([0, 255, 0, 255]);
  });
});
