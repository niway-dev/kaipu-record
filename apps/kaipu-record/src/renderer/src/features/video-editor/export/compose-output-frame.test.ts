import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { Redaction } from "../privacy/redaction";
import type { CameraPathMessage } from "./export-messages";
import { createOutputComposer } from "./compose-output-frame";

/** Every draw call on every fake canvas, in order, tagged with the canvas it hit. */
let log: Array<{ canvas: string; call: string; args: unknown[] }> = [];

function fakeContext(canvas: string): OffscreenCanvasRenderingContext2D {
  const state: Record<string, unknown> = { imageSmoothingEnabled: true };
  return new Proxy({} as OffscreenCanvasRenderingContext2D, {
    get: (_t, key: string) =>
      key in state
        ? state[key]
        : (...args: unknown[]) => void log.push({ canvas, call: key, args }),
    set: (_t, key: string, value) => {
      state[key] = value;
      return true;
    },
  });
}

let canvases = 0;
class FakeOffscreenCanvas {
  readonly name: string;
  private readonly context: OffscreenCanvasRenderingContext2D;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.name = `offscreen-${canvases++}`;
    this.context = fakeContext(this.name);
  }
  getContext(): OffscreenCanvasRenderingContext2D {
    return this.context;
  }
}

beforeEach(() => {
  log = [];
  canvases = 0;
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
});
afterEach(() => vi.unstubAllGlobals());

const FRAME = { tag: "screen-frame" } as unknown as CanvasImageSource;
const WEBCAM_FRAME = { tag: "webcam-frame" } as unknown as CanvasImageSource;
const webcamImage = { image: WEBCAM_FRAME, width: 1280, height: 720 };
const SOURCE = { width: 1920, height: 1080 };

const webcam = (segments: WebcamScene["segments"] = []): WebcamScene => ({
  layout: { ...WEBCAM_DEFAULTS, shadow: false, mirrored: false },
  segments,
});

/** A camera path that holds `scale` at the frame centre for 10 s. */
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
  rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  fill: "#18181b",
  label: "",
} as Redaction;

function composer(opts: {
  camera?: CameraPathMessage | null;
  redactions?: Redaction[];
  webcam?: WebcamScene | null;
  framed?: { width: number; height: number; mode: "fit" | "fill" };
}) {
  const output = fakeContext("output");
  const view = opts.framed ? new FakeOffscreenCanvas(SOURCE.width, SOURCE.height) : null;
  const ctx = view ? fakeContext("view") : output;
  const compose = createOutputComposer({
    ctx,
    width: SOURCE.width,
    height: SOURCE.height,
    camera: opts.camera ?? null,
    redactions: opts.redactions ?? [],
    overlayWindows: [],
    overlayBitmaps: new Map(),
    webcam: opts.webcam ?? null,
    framing:
      view && opts.framed
        ? {
            view: view as unknown as OffscreenCanvas,
            ctx: output,
            width: opts.framed.width,
            height: opts.framed.height,
            mode: opts.framed.mode,
            padding: "black",
          }
        : null,
  });
  // Construction probes the canvas filter; only what the frames draw matters below.
  log = [];
  return { compose, view };
}

const draws = () => log.filter((entry) => entry.call === "drawImage");
const webcamDraws = () => draws().filter((entry) => entry.args[0] === WEBCAM_FRAME);

describe("createOutputComposer: the webcam layer (ADR 0033)", () => {
  it("draws on a direct frame (no zoom, no region): the frame, then the webcam on top", () => {
    const { compose } = composer({ webcam: webcam() });
    compose.clip(FRAME, 1, 1 / 30, 1, webcamImage);
    expect(draws().map((d) => d.args[0])).toEqual([FRAME, WEBCAM_FRAME]);
    expect(webcamDraws()[0]!.canvas).toBe("output");
  });

  it("composes frame → redactions → crop, then the webcam last, at full size on the output", () => {
    const { compose } = composer({ webcam: webcam(), camera: camera(2), redactions: [cover] });
    compose.clip(FRAME, 1, 1 / 30, 1, webcamImage);
    const calls = log.map((entry) => `${entry.canvas}:${entry.call}`);
    const redaction = calls.findIndex((c) => c.endsWith(":fillRect") && !c.startsWith("output"));
    const crop = log.findIndex(
      (entry) => entry.canvas === "output" && entry.call === "drawImage" && entry.args.length === 9,
    );
    const face = log.findIndex((entry) => entry.args[0] === WEBCAM_FRAME);
    expect(redaction).toBeGreaterThanOrEqual(0);
    expect(redaction).toBeLessThan(crop);
    expect(crop).toBeLessThan(face);
    expect(face).toBe(log.length - 2); // drawImage, then the clip's restore
    // Shrink during zoom: scale 2 ≥ 1.5 → the full scaleDuringZoom (0.7) of a 0.22 bubble.
    const side = webcamDraws()[0]!.args[7] as number;
    expect(side).toBeCloseTo(0.22 * 1080 * 0.7);
  });

  it.each([
    ["Vertical (Fill)", { width: 1080, height: 1920, mode: "fill" as const }],
    ["Square (Fit)", { width: 1080, height: 1080, mode: "fit" as const }],
  ])("%s: the webcam is drawn after the framer, inside the target canvas", (_name, framed) => {
    const { compose, view } = composer({
      webcam: { ...webcam(), layout: { ...webcam().layout, size: 0.6, position: { x: 1, y: 1 } } },
      framed,
    });
    compose.clip(FRAME, 1, 1 / 30, 1, webcamImage);
    const framedDraw = log.findIndex(
      (entry) => entry.canvas === "output" && entry.args[0] === view,
    );
    const face = log.findIndex((entry) => entry.args[0] === WEBCAM_FRAME);
    expect(framedDraw).toBeGreaterThanOrEqual(0);
    expect(framedDraw).toBeLessThan(face);
    const [, , , , , dx, dy, dw, dh] = webcamDraws()[0]!.args as number[];
    expect(webcamDraws()[0]!.canvas).toBe("output");
    expect(dx).toBeGreaterThanOrEqual(0);
    expect(dy).toBeGreaterThanOrEqual(0);
    expect(dx + dw).toBeLessThanOrEqual(framed.width + 1e-6);
    expect(dy + dh).toBeLessThanOrEqual(framed.height + 1e-6);
  });

  it("draws nothing inside a hidden segment, or without a webcam frame at that time", () => {
    const { compose } = composer({
      webcam: webcam([{ id: "h", start: 2, end: 4, mode: "hidden" }]),
    });
    compose.clip(FRAME, 3, 1 / 30, 3, webcamImage);
    compose.clip(FRAME, 5, 1 / 30, 5, null);
    expect(webcamDraws()).toEqual([]);
    compose.clip(FRAME, 5, 1 / 30, 5, webcamImage);
    expect(webcamDraws()).toHaveLength(1);
  });

  it("a recording without a webcam composes exactly as before, whatever frame is passed", () => {
    const { compose } = composer({ webcam: null });
    compose.clip(FRAME, 1, 1 / 30, 1, webcamImage);
    expect(draws().map((d) => d.args[0])).toEqual([FRAME]);
  });

  it("slides draw no webcam, and frame Fit on fixed-canvas presets", () => {
    const { compose, view } = composer({
      webcam: webcam(),
      framed: { width: 1080, height: 1920, mode: "fill" },
    });
    compose.slide(undefined, 1);
    expect(webcamDraws()).toEqual([]);
    const framedDraw = log.find((entry) => entry.canvas === "output" && entry.args[0] === view)!;
    // Fit on a portrait canvas: the landscape view is letterboxed, not cropped (sx = 0).
    expect(framedDraw.args[1]).toBe(0);
  });
});

describe("both exports draw the layer through the shared composer", () => {
  // The workers cannot run in jsdom (WebCodecs); what keeps MP4 and GIF from diverging is
  // that both hand the plan's webcam and the decoded webcam frame to createOutputComposer.
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const read = (file: string): string =>
    readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it.each(["export-worker.ts", "gif-worker.ts"])("%s", (file) => {
    const source = read(file);
    expect(source).toMatch(/createOutputComposer\(\{[^}]*webcam: plan\.webcam/);
    expect(source).toMatch(/compose\.clip\([^)]*webcam/i);
  });
});
