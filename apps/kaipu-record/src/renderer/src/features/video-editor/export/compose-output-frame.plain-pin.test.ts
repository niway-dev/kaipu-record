// The PLAIN composer, pinned to the base code (NIW2-668 review S3).
//
// A plain scene (no background, or `none` with stored numbers) must draw exactly what the
// composer drew before backgrounds existed. Comparing the new composer with ITSELF cannot
// prove that: a regression in the shared plain path would change both sides. So the output of
// each fixture below is hashed and pinned to a constant CAPTURED FROM THE BASE CODE.
//
// Provenance: the hashes were produced by running THIS file, unchanged, in a second worktree
// at `f5c8243c` (origin/feature/niw2-667-timeline-zoom, PR 4 of the editor stack: the commit
// this PR is built on), with this PR's `test/soft-canvas.ts` copied beside it. That commit's
// `compose-output-frame.ts`, `compose-frame.ts` and `compose-webcam.ts` are byte-identical to
// origin/main's (`git diff` empty, 2026-11-07), so the pins are main's plain path too.
//
// What a failure means: the plain path draws something differently from the base. Do not
// re-pin to make it pass. If the change is intended (a new plain-path feature), regenerate from
// the code BEFORE it — and if `test/soft-canvas.ts` itself changed its rasterising, from the
// base with the NEW soft canvas copied in — and say so in the commit:
//
//   PRINT_PLAIN_HASHES=1 bun run test -- compose-output-frame.plain-pin   (prints, then fails)
//
// The software canvas checks what is drawn, where and in what order — the composer's logic —
// not Skia's anti-aliasing (the real-canvas parity is in the PR's Proof).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solidCanvas, SoftCanvas } from "../../../test/soft-canvas";
import type { Redaction } from "../privacy/redaction";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { CameraPathMessage } from "./export-messages";
import { createOutputComposer, type OutputComposerOptions } from "./compose-output-frame";

beforeEach(() => vi.stubGlobal("OffscreenCanvas", SoftCanvas));
afterEach(() => vi.unstubAllGlobals());

const SRC = { width: 960, height: 540 };

/** The PINS: sha256 of the output's RGBA bytes, from the base code at f5c8243c. */
const PINNED: Record<string, string> = {
  direct: "6df9bdac127b7a6406487f02a2722f5b4595703cc4b545a71c77b1fd15c2f224",
  "zoom-and-cover": "d1f68b301017c2511268238a0d237692a12b91ece110d60e32f320780e1586d0",
  slide: "73f7855c54fcb661df93362739ee1fcb62b693c3b490204496a0047ea5b911f5",
  "direct-webcam": "79396292bfb0e04a2c7771a7acebb9cc341839bcdde6ae04995b7a90ac9743a9",
  "vertical-fit-black": "005c5d648a859edcb5af0976cc5bc655b77f79b2a6b2aebd9526002b30c96732",
  "vertical-fit-blur": "c46c236c07be57fff8fa2ba08fbb52f27e4896a15da9c7353f13e66767ff3b6e",
  "square-fill": "dc8fe43e26fa75ca9d9d7ea5b02e546dabc4747b9f0cadd292f7e940cb8edcfd",
  "vertical-zoom-webcam": "efffee2366bb19e6e9d85e44aa704e69ad87ceff6f52335370abc6951df310ca",
};

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
  rect: { x: 0.45, y: 0.45, w: 0.12, h: 0.14 },
  fill: "#0000ff",
  label: "",
};

const webcam: WebcamScene = {
  layout: { ...WEBCAM_DEFAULTS, shape: "circle", shadow: false, mirrored: false },
  segments: [],
};

/** A busy, deterministic source frame: a red corner, a blue block, a yellow block on green. */
function scene(): SoftCanvas {
  const frame = solidCanvas(SRC.width, SRC.height, "#00aa44");
  const ctx = frame.getContext();
  for (const [color, x, y, w, h] of [
    ["#ff0000", 0, 0, 100, 100],
    ["#1d4ed8", 400, 200, 150, 90],
    ["#facc15", 800, 400, 100, 100],
    ["#ffffff", 120, 420, 300, 12],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  return frame;
}

const hash = (canvas: SoftCanvas): string =>
  createHash("sha256").update(Buffer.from(canvas.data)).digest("hex");

const webcamFrame = {
  image: {
    image: solidCanvas(64, 64, "#ffff00") as unknown as CanvasImageSource,
    width: 64,
    height: 64,
  },
  sourceTs: 0,
};

interface Fixture {
  name: string;
  /** Composes the fixture with `extra` (the options a plain scene may or may not carry). */
  run: (extra: Partial<OutputComposerOptions>) => SoftCanvas;
}

function direct(extra: Partial<OutputComposerOptions>, options: { zoom?: boolean; cam?: boolean }) {
  const output = new SoftCanvas(SRC.width, SRC.height);
  const compose = createOutputComposer({
    ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
    width: SRC.width,
    height: SRC.height,
    camera: options.zoom ? camera(2) : null,
    redactions: options.zoom ? [cover] : [],
    overlayWindows: [],
    overlayBitmaps: new Map(),
    webcam: options.cam ? webcam : null,
    ...extra,
  });
  compose.clip(
    scene() as unknown as CanvasImageSource,
    0,
    1 / 30,
    0,
    options.cam ? webcamFrame : null,
  );
  return output;
}

function framed(
  extra: Partial<OutputComposerOptions>,
  target: { width: number; height: number },
  mode: "fit" | "fill",
  padding: "black" | "blur",
  options: { zoom?: boolean; cam?: boolean } = {},
) {
  const output = new SoftCanvas(target.width, target.height);
  const view = new SoftCanvas(SRC.width, SRC.height);
  const compose = createOutputComposer({
    ctx: view.getContext() as unknown as OffscreenCanvasRenderingContext2D,
    width: SRC.width,
    height: SRC.height,
    camera: options.zoom ? camera(2) : null,
    redactions: options.zoom ? [cover] : [],
    overlayWindows: [],
    overlayBitmaps: new Map(),
    webcam: options.cam ? webcam : null,
    framing: {
      view: view as unknown as OffscreenCanvas,
      ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
      width: target.width,
      height: target.height,
      mode,
      padding,
    },
    ...extra,
  });
  compose.clip(
    scene() as unknown as CanvasImageSource,
    0,
    1 / 30,
    0,
    options.cam ? webcamFrame : null,
  );
  return output;
}

const FIXTURES: Fixture[] = [
  { name: "direct", run: (extra) => direct(extra, {}) },
  { name: "zoom-and-cover", run: (extra) => direct(extra, { zoom: true }) },
  {
    name: "slide",
    run: (extra) => {
      const output = new SoftCanvas(SRC.width, SRC.height);
      const compose = createOutputComposer({
        ctx: output.getContext() as unknown as OffscreenCanvasRenderingContext2D,
        width: SRC.width,
        height: SRC.height,
        camera: null,
        redactions: [],
        overlayWindows: [],
        overlayBitmaps: new Map(),
        ...extra,
      });
      compose.slide(solidCanvas(640, 360, "#e5e7eb") as unknown as ImageBitmap, 0);
      return output;
    },
  },
  { name: "direct-webcam", run: (extra) => direct(extra, { cam: true }) },
  {
    name: "vertical-fit-black",
    run: (extra) => framed(extra, { width: 540, height: 960 }, "fit", "black"),
  },
  {
    name: "vertical-fit-blur",
    run: (extra) => framed(extra, { width: 540, height: 960 }, "fit", "blur"),
  },
  {
    name: "square-fill",
    run: (extra) => framed(extra, { width: 540, height: 540 }, "fill", "black"),
  },
  {
    name: "vertical-zoom-webcam",
    run: (extra) =>
      framed(extra, { width: 540, height: 960 }, "fit", "blur", { zoom: true, cam: true }),
  },
];

describe("the plain composer draws exactly what the base code drew (review S3)", () => {
  if (process.env["PRINT_PLAIN_HASHES"]) {
    it("prints the current hashes", () => {
      const current = Object.fromEntries(FIXTURES.map((f) => [f.name, hash(f.run({}))]));
      console.log(`PLAIN_HASHES ${JSON.stringify(current)}`);
      throw new Error("PRINT_PLAIN_HASHES is set: printed the hashes, not comparing them");
    });
    return;
  }

  it.each(FIXTURES.map((f) => [f.name, f] as const))("%s with no background", (name, fixture) => {
    expect(hash(fixture.run({}))).toBe(PINNED[name]);
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    "%s with `none` and stored padding, radius and shadow",
    (name, fixture) => {
      const background = { bg: "none" as const, padding: 96, radius: 28, shadow: 100 };
      expect(hash(fixture.run({ background }))).toBe(PINNED[name]);
    },
  );

  it("pins eight distinct pictures, so a fixture that stopped drawing would not hide", () => {
    const hashes = FIXTURES.map((f) => PINNED[f.name]);
    expect(new Set(hashes).size).toBe(FIXTURES.length);
  });
});
