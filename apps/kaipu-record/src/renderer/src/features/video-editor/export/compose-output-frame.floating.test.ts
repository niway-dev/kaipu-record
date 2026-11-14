import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { ImageMediaItem } from "../scene";
import type { LayoutEntry } from "../timeline";
import { createOutputComposer, type OutputComposerOptions } from "./compose-output-frame";
import type { FloatingMediaPlan } from "./floating-frame";

interface Call {
  canvas: string;
  call: string;
  args: unknown[];
  /** `globalAlpha` at the moment of the call. */
  alpha: unknown;
}
let log: Call[] = [];

function fakeContext(canvas: string): OffscreenCanvasRenderingContext2D {
  const state: Record<string, unknown> = { imageSmoothingEnabled: true, globalAlpha: 1 };
  const saved: Array<Record<string, unknown>> = [];
  return new Proxy({} as OffscreenCanvasRenderingContext2D, {
    get: (_t, key: string) => {
      if (key === "save") return () => void saved.push({ ...state });
      if (key === "createLinearGradient") return () => ({ addColorStop() {} });
      if (key === "restore") return () => void Object.assign(state, saved.pop());
      return key in state
        ? state[key]
        : (...args: unknown[]) =>
            void log.push({ canvas, call: key, args, alpha: state.globalAlpha });
    },
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

const W = 1920;
const H = 1080;
const FRAME = { tag: "screen-frame" } as unknown as CanvasImageSource;
const WEBCAM_IMAGE = {
  image: { tag: "webcam-frame" } as unknown as CanvasImageSource,
  width: 1280,
  height: 720,
};
const bitmap = (tag: string) => ({ tag, width: 100, height: 100 }) as unknown as ImageBitmap;

const item = (id: string, z: number, extra: Partial<ImageMediaItem> = {}): ImageMediaItem => ({
  id,
  kind: "image",
  assetId: `asset-${id}`,
  naturalWidth: 1600,
  naturalHeight: 900,
  anchor: { kind: "source", time: 0 },
  duration: 10,
  box: { x: 0.5, y: 0.5, width: 0.5 },
  z,
  fadeInMs: 0,
  fadeOutMs: 0,
  ...extra,
});

/** One 10 s clip, source 0-10, on timeline 0-10. */
const LAYOUT: LayoutEntry[] = [
  { itemId: "c", kind: "clip", timelineStart: 0, timelineEnd: 10, sourceStart: 0, sourceEnd: 10 },
];
/** A 10 s slide, to compose over a slide frame. */
const SLIDE_LAYOUT: LayoutEntry[] = [
  {
    itemId: "s",
    kind: "slide",
    timelineStart: 0,
    timelineEnd: 10,
    sourceStart: 0,
    sourceEnd: 10,
    assetId: "slide-asset",
  },
];

function floatingOf(
  items: ImageMediaItem[],
  layout = LAYOUT,
  timeOffset = 0,
): NonNullable<OutputComposerOptions["floating"]> {
  const plan: FloatingMediaPlan = { items, layout, timeOffset };
  return {
    plan,
    bitmaps: new Map(items.map((i) => [i.assetId, bitmap(i.assetId)])),
  };
}

function compose(options: Partial<OutputComposerOptions>, outTs: number, withWebcam = false) {
  const outputCtx = fakeContext("output");
  const composer = createOutputComposer({
    ctx: outputCtx,
    width: W,
    height: H,
    camera: null,
    redactions: [],
    overlayWindows: [],
    overlayBitmaps: new Map(),
    ...options,
  });
  // The composer probes canvas filter support on creation; that is not a frame draw.
  log = [];
  composer.clip(
    FRAME,
    outTs,
    1 / 30,
    outTs,
    withWebcam ? { image: WEBCAM_IMAGE, sourceTs: outTs } : null,
  );
}

const drawnTags = (): string[] =>
  log
    .filter((c) => c.call === "drawImage")
    .map((c) => (c.args[0] as { tag?: string }).tag ?? "canvas");

describe("the composer draws floating images", () => {
  it("draws items back to front with their opacity, at mediaBoxPx, between content and webcam", () => {
    const webcam: WebcamScene = {
      layout: { ...WEBCAM_DEFAULTS, shadow: false, mirrored: false },
      segments: [],
    };
    compose(
      {
        webcam,
        floating: floatingOf([
          item("front", 2, { fadeInMs: 1000 }),
          item("back", 1, { box: { x: 0.25, y: 0.25, width: 0.2 } }),
        ]),
      },
      0.5,
      true,
    );
    expect(drawnTags()).toEqual(["screen-frame", "asset-back", "asset-front", "webcam-frame"]);
    const draws = log.filter((c) => c.call === "drawImage");
    const back = draws[1];
    // Box 0.2 wide, centred at 0.25/0.25, 16:9 image: 384 x 216, top-left (480-192, 270-108).
    expect(back.args.slice(1)).toEqual([288, 162, 384, 216]);
    expect(back.alpha).toBe(1);
    const front = draws[2];
    expect(front.args.slice(1)).toEqual([480, 270, 960, 540]);
    // 0.5 s into a 1 s fade-in.
    expect(front.alpha).toBe(0.5);
    // Alpha is restored for what comes next (the webcam is opaque).
    expect(draws[3].alpha).toBe(1);
  });

  it("draws nothing for an item that is not on screen at that time, or has no bitmap", () => {
    const items = [item("a", 0, { anchor: { kind: "source", time: 5 } }), item("b", 1)];
    const floating = floatingOf(items);
    floating.bitmaps.delete("asset-b");
    compose({ floating }, 2);
    expect(drawnTags()).toEqual(["screen-frame"]);
  });

  it("a scene with media and no webcam or background still draws them on the output", () => {
    compose({ floating: floatingOf([item("a", 0)]) }, 1);
    const draws = log.filter((c) => c.call === "drawImage");
    expect(draws.map((c) => c.canvas)).toEqual(["output", "output"]);
    expect(draws[1].args.slice(1)).toEqual([480, 270, 960, 540]);
  });

  it("without floating images the draw calls are exactly the ones they were", () => {
    compose({}, 1);
    const before = log.map((c) => `${c.canvas}.${c.call}`);
    log = [];
    canvases = 0;
    compose({ floating: floatingOf([]) }, 1);
    expect(log.map((c) => `${c.canvas}.${c.call}`)).toEqual(before);
  });

  it("is never zoomed: the crop happens before, and the item keeps its picture rect", () => {
    const camera = {
      fps: 30,
      cx: new Float32Array(300).fill(0.5),
      cy: new Float32Array(300).fill(0.5),
      scale: new Float32Array(300).fill(2),
    };
    compose({ camera, floating: floatingOf([item("a", 0)]) }, 1);
    const calls = log.filter((c) => c.call === "drawImage");
    // The zoom crop is a 9-argument drawImage from the work canvas; the floating one comes after it.
    const cropIndex = calls.findIndex((c) => c.args.length === 9);
    const floatIndex = calls.findIndex((c) => (c.args[0] as { tag?: string }).tag === "asset-a");
    expect(cropIndex).toBeGreaterThanOrEqual(0);
    expect(floatIndex).toBeGreaterThan(cropIndex);
    expect(calls[floatIndex].args.slice(1)).toEqual([480, 270, 960, 540]);
  });

  it("reads the plan's clock plus its offset (a GIF range)", () => {
    // The item starts at timeline 5; the plan's time 0 is timeline 4.
    const items = [item("a", 0, { anchor: { kind: "source", time: 5 }, duration: 2 })];
    compose({ floating: floatingOf(items, LAYOUT, 4) }, 0.5);
    expect(drawnTags()).toEqual(["screen-frame"]);
    log = [];
    compose({ floating: floatingOf(items, LAYOUT, 4) }, 1.5);
    expect(drawnTags()).toEqual(["screen-frame", "asset-a"]);
  });

  it("draws over a slide, after the slide and before the end of the frame", () => {
    const outputCtx = fakeContext("output");
    const composer = createOutputComposer({
      ctx: outputCtx,
      width: W,
      height: H,
      camera: null,
      redactions: [],
      overlayWindows: [],
      overlayBitmaps: new Map(),
      floating: floatingOf(
        [item("a", 0, { anchor: { kind: "item", itemId: "s", offset: 0 } })],
        SLIDE_LAYOUT,
      ),
    });
    log = [];
    composer.slide(bitmap("slide"), 1);
    expect(drawnTags()).toEqual(["slide", "asset-a"]);
  });
});

describe("under a background", () => {
  const background = { bg: "ocean", padding: 60, radius: 10, shadow: 0 } as never;

  it("draws on the picture, which is then placed inset, never on the padding", () => {
    compose({ background, floating: floatingOf([item("a", 0)]) }, 1);
    const draws = log.filter((c) => c.call === "drawImage");
    const floatDraw = draws.find((c) => (c.args[0] as { tag?: string }).tag === "asset-a")!;
    // Not the output canvas: the picture surface, in the picture's own coordinates (the same
    // rect as without a background); the whole picture is then drawn inset on the output.
    expect(floatDraw.canvas).not.toBe("output");
    expect(floatDraw.args.slice(1)).toEqual([480, 270, 960, 540]);
    const placed = draws.filter((c) => c.canvas === "output");
    expect(placed.length).toBeGreaterThan(0);
    expect(draws.indexOf(floatDraw)).toBeLessThan(draws.indexOf(placed[placed.length - 1]));
    const pictureBlit = placed[placed.length - 1];
    // Inset: smaller than the output.
    expect(pictureBlit.args[3] as number).toBeLessThan(W);
    expect(pictureBlit.args[4] as number).toBeLessThan(H);
  });
});

describe("under a fixed-canvas framing preset", () => {
  it("lays the box out on the framed canvas, the way the webcam is, after the framer", () => {
    // A vertical 1080 x 1920 export of a 1920 x 1080 source: the preview has no such canvas, the
    // export does, and a floating image is a share of the OUTPUT frame there (bars included).
    const view = new FakeOffscreenCanvas(W, H) as unknown as OffscreenCanvas;
    const framed = fakeContext("framed");
    compose(
      {
        framing: { view, ctx: framed, width: 1080, height: 1920, mode: "fit", padding: "black" },
        floating: floatingOf([item("a", 0)]),
      } as Partial<OutputComposerOptions>,
      1,
    );
    const draws = log.filter((c) => c.call === "drawImage");
    const floatDraw = draws.find((c) => (c.args[0] as { tag?: string }).tag === "asset-a")!;
    expect(floatDraw).toBeDefined();
    expect(floatDraw.canvas).toBe("framed");
    // Width 0.5 of 1080 = 540, height from the image's 16:9 = 303.75, centred.
    const [, x, y, w, h] = floatDraw.args as number[];
    expect(w).toBeCloseTo(540);
    expect(h).toBeCloseTo(303.75);
    expect(x).toBeCloseTo(270);
    expect(y).toBeCloseTo(1920 / 2 - 303.75 / 2);
  });
});
