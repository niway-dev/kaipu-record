import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";

// mediabunny cannot decode in jsdom: a fake Input/CanvasSink records what the workers open.
const { inputs, sinks } = vi.hoisted(() => ({
  inputs: [] as Array<{ source: unknown; disposed: boolean }>,
  sinks: [] as Array<{ options: unknown; ranges: Array<[number, number]>; at: number[][] }>,
}));

vi.mock("mediabunny", () => {
  const fps = 30;
  const frame = (i: number) => ({
    canvas: { width: 1280, height: 720, frame: i },
    timestamp: i / fps,
    duration: 1 / fps,
  });
  class Input {
    disposed = false;
    constructor(opts: { source: unknown }) {
      const record = { source: opts.source, disposed: false };
      inputs.push(record);
      this.dispose = () => {
        record.disposed = true;
      };
    }
    dispose: () => void;
    async getPrimaryVideoTrack() {
      return { computeDuration: async () => 2 };
    }
  }
  class CanvasSink {
    private readonly record: (typeof sinks)[number];
    constructor(_track: unknown, options: unknown) {
      this.record = { options, ranges: [], at: [] };
      sinks.push(this.record);
    }
    async *canvases(start: number, end: number) {
      this.record.ranges.push([start, end]);
      for (let i = Math.floor(start * fps + 1e-9); i / fps < end && i < 2 * fps; i++)
        yield frame(i);
    }
    async *canvasesAtTimestamps(times: number[]) {
      this.record.at.push(times);
      for (const t of times) yield frame(Math.floor(t * fps + 1e-9));
    }
  }
  return { ALL_FORMATS: [], BlobSource: class {}, CanvasSink, Input };
});

const { openWebcamSource, WEBCAM_CANVAS_POOL_SIZE } = await import("./webcam-source");

const SCENE: WebcamScene = { layout: { ...WEBCAM_DEFAULTS }, segments: [] };
const MESSAGE = { blob: new Blob(["cam"]), startOffsetMs: 500 };

beforeEach(() => {
  inputs.length = 0;
  sinks.length = 0;
});

describe("openWebcamSource", () => {
  it("opens no second Input for a recording without a webcam (no file, or no layer)", async () => {
    expect(await openWebcamSource(null, SCENE)).toBeNull();
    expect(await openWebcamSource(MESSAGE, null)).toBeNull();
    expect(inputs).toHaveLength(0);
  });

  it("opens the file once, at native size with a small canvas pool, and disposes it", async () => {
    const source = (await openWebcamSource(MESSAGE, SCENE))!;
    expect(inputs).toHaveLength(1);
    expect(sinks[0]!.options).toEqual({ poolSize: WEBCAM_CANVAS_POOL_SIZE });
    expect(source.duration).toBe(2);
    source.dispose();
    expect(inputs[0]!.disposed).toBe(true);
  });

  it("decodes a clip's source range shifted by the offset, in lockstep", async () => {
    const source = (await openWebcamSource(MESSAGE, SCENE))!;
    const cursor = source.cursorFor(1, 1.1);
    // Source 1.0 s is webcam 0.5 s: frame 15.
    const first = await cursor.frameAt(1);
    expect((first!.canvas as unknown as { frame: number }).frame).toBe(15);
    await cursor.close();
    expect(sinks[0]!.ranges[0]![0]).toBeCloseTo(0.4);
    expect(sinks[0]!.ranges[0]![1]).toBeCloseTo(0.6);
  });

  it("does not decode a clip that sits wholly before the webcam's first frame", async () => {
    const source = (await openWebcamSource(MESSAGE, SCENE))!;
    const cursor = source.cursorFor(0, 0.4);
    expect(await cursor.frameAt(0.2)).toBeNull();
    expect(sinks[0]!.ranges).toEqual([]);
  });

  it("GIF: one webcam frame per sampled time, none before the first frame or after the last", async () => {
    const source = (await openWebcamSource(MESSAGE, SCENE))!;
    const frames: Array<number | null> = [];
    for await (const image of source.framesAt([0.2, 1, 2.4, 2.6])) {
      frames.push(image ? (image.image as unknown as { frame: number }).frame : null);
    }
    // 0.2 → webcam −0.3 (before); 1 → 0.5 (15); 2.4 → 1.9 (57); 2.6 → 2.1 (past its 2 s).
    expect(frames).toEqual([null, 15, 57, null]);
  });
});
