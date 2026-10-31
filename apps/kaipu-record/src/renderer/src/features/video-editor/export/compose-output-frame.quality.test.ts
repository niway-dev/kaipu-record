// Upscale quality (NIW2-564): its own file, since the webcam tests stub OffscreenCanvas
// with a different fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFramer, createOutputComposer } from "./compose-output-frame";

/** Records every call and property write, in order (as compose-frame.test.ts does). */
function fakeCtx(): { ctx: OffscreenCanvasRenderingContext2D; log: unknown[][] } {
  const log: unknown[][] = [];
  // The browser defaults: smoothing on, at "low" (bilinear).
  const state: Record<string, unknown> = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
  };
  const ctx = new Proxy({} as OffscreenCanvasRenderingContext2D, {
    get: (_t, key: string) =>
      key in state ? state[key] : (...args: unknown[]) => void log.push([key, ...args]),
    set: (_t, key: string, value) => {
      state[key] = value;
      log.push([`=${key}`, value]);
      return true;
    },
  });
  return { ctx, log };
}

/** The smoothing in effect at each drawImage call, replayed from the log. */
function smoothingAtDraws(log: unknown[][]): Array<{ enabled: unknown; quality: unknown }> {
  let enabled: unknown = true;
  let quality: unknown = "low";
  const draws: Array<{ enabled: unknown; quality: unknown }> = [];
  for (const [key, value] of log) {
    if (key === "=imageSmoothingEnabled") enabled = value;
    else if (key === "=imageSmoothingQuality") quality = value;
    else if (key === "drawImage") draws.push({ enabled, quality });
  }
  return draws;
}

// jsdom has no OffscreenCanvas: the composer's scratch canvases only need a 2D context.
class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return fakeCtx().ctx;
  }
}

beforeEach(() => vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas));
afterEach(() => vi.unstubAllGlobals());

describe("upscale quality on fixed canvases (NIW2-564)", () => {
  it("frames a 1916×1048 view onto 2560×1440 with high-quality smoothing (YouTube Fit)", () => {
    const { ctx, log } = fakeCtx();
    const framer = createFramer({ ctx, width: 2560, height: 1440, padding: "black" });
    framer.frame(new FakeOffscreenCanvas(1916, 1048) as unknown as OffscreenCanvas, "fit");
    const draws = smoothingAtDraws(log);
    expect(draws).toHaveLength(1);
    expect(draws[0]).toEqual({ enabled: true, quality: "high" });
  });

  it("uses high-quality smoothing for Fill and the blurred padding too", () => {
    const { ctx, log } = fakeCtx();
    const framer = createFramer({ ctx, width: 1080, height: 1920, padding: "blur" });
    const view = new FakeOffscreenCanvas(1916, 1048) as unknown as OffscreenCanvas;
    framer.frame(view, "fill");
    framer.frame(view, "fit");
    const draws = smoothingAtDraws(log);
    expect(draws.length).toBeGreaterThanOrEqual(3);
    for (const draw of draws) expect(draw).toEqual({ enabled: true, quality: "high" });
  });

  it("draws a contained slide with high-quality smoothing", () => {
    const { ctx, log } = fakeCtx();
    const compose = createOutputComposer({
      ctx,
      width: 3840,
      height: 2160,
      camera: null,
      redactions: [],
      overlayWindows: [],
      overlayBitmaps: new Map(),
    });
    compose.slide({ width: 1280, height: 720 } as ImageBitmap, 0);
    const draws = smoothingAtDraws(log);
    expect(draws).toHaveLength(1);
    expect(draws[0]).toEqual({ enabled: true, quality: "high" });
  });
});
