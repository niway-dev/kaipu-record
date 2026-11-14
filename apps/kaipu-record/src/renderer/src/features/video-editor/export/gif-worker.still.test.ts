import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { ExportPlan } from "./export-plan";
import type { GifStartMessage } from "./gif-messages";

// The GIF worker's "still" mode, run for real on its message handler like gif-worker.test.ts:
// WebCodecs and the composer's canvas work are faked at the module boundary; what is
// exercised is the worker's wiring for one frame: the right segment and source time reach
// the composer, the answer is the full-size canvas as a PNG, and nothing is downscaled.

const { clip, slide, createOutputComposer, sinkState, canvases, decodes } = vi.hoisted(() => {
  const clip = vi.fn();
  const slide = vi.fn();
  return {
    clip,
    slide,
    createOutputComposer: vi.fn(() => ({ clip, slide })),
    sinkState: { nothingDecodable: false },
    canvases: [] as Array<{ width: number; height: number; blobType?: string }>,
    // Every `canvasesAtTimestamps` call: the file whose sink decoded, and the times asked.
    decodes: [] as Array<{ blob: unknown; times: number[] }>,
  };
});

vi.mock("./compose-output-frame", () => ({ createOutputComposer }));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {
    constructor(public blob: unknown) {}
  },
  Input: class {
    blob: unknown;
    constructor(options: { source: { blob: unknown } }) {
      this.blob = options.source.blob;
    }
    getPrimaryVideoTrack = async () => ({ blob: this.blob });
    dispose(): void {}
  },
  CanvasSink: class {
    constructor(public track: { blob: unknown }) {}
    async *canvasesAtTimestamps(times: number[]) {
      decodes.push({ blob: this.track.blob, times });
      for (const t of times) {
        yield sinkState.nothingDecodable
          ? null
          : { canvas: `screen@${t}`, timestamp: t, duration: 1 / 30 };
      }
    }
  },
}));
vi.mock("./webcam-source", () => ({
  openWebcamSourceOrNone: vi.fn(async (_file: unknown, scene: WebcamScene | null) =>
    scene
      ? {
          framesAt: async function* (times: number[]) {
            for (const _t of times) yield { image: "face", width: 1, height: 1 };
          },
          dispose: vi.fn(),
        }
      : null,
  ),
}));
vi.mock("./gif-encode", () => ({
  buildGlobalPalette: () => [],
  measureFramePair: () => ({ full: 1, diff: 1 }),
  estimateGifBytes: () => 1,
  GifStreamWriter: class {},
}));

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {
    canvases.push(this);
  }
  getContext() {
    return new Proxy({}, { get: () => () => {}, set: () => true });
  }
  async convertToBlob(options: { type: string }) {
    (this as { blobType?: string }).blobType = options.type;
    return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);
  }
}

const PLAN = {
  segments: [
    { kind: "slide", timelineStart: 0, duration: 3, assetId: "a1" },
    { kind: "clip", timelineStart: 3, duration: 2, sourceStart: 5, sourceEnd: 7 },
  ],
  totalDuration: 5,
  redactions: [{ id: "r1" }],
  overlayWindows: [{ overlayId: "o1", start: 0, end: 5 }],
  webcam: null as WebcamScene | null,
} as unknown as ExportPlan;

function message(stillTime: number, plan: ExportPlan = PLAN): GifStartMessage {
  return {
    type: "start",
    mode: "still",
    stillTime,
    sourceBlob: new Blob(["x"]),
    plan,
    overlays: [],
    slides: [{ assetId: "a1", bitmap: "slide-bitmap" as unknown as ImageBitmap }],
    source: { width: 1920, height: 1080 },
    output: { width: 1920, height: 1080 },
    fps: 10,
    camera: null,
    webcam: plan.webcam ? { blob: new Blob(["cam"]), startOffsetMs: 0 } : null,
    joined: [],
  } as GifStartMessage;
}

let posted: Array<{ type: string } & Record<string, unknown>> = [];

async function runWorker(msg: GifStartMessage, until: string[] = ["still", "error"]) {
  vi.resetModules();
  await import("./gif-worker");
  const handler = (self as unknown as { onmessage: (e: MessageEvent) => void }).onmessage;
  handler({ data: msg } as MessageEvent);
  await vi.waitFor(() => expect(posted.some((m) => until.includes(m.type))).toBe(true));
}

beforeEach(() => {
  posted = [];
  canvases.length = 0;
  decodes.length = 0;
  sinkState.nothingDecodable = false;
  clip.mockClear();
  slide.mockClear();
  createOutputComposer.mockClear();
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.spyOn(self, "postMessage").mockImplementation((m: unknown) => void posted.push(m as never));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gif-worker still mode", () => {
  it("composes the one clip frame at its source time and answers the full-size PNG", async () => {
    await runWorker(message(4));
    expect(clip).toHaveBeenCalledTimes(1);
    const [screenCanvas, sourceTs, , outTs] = clip.mock.calls[0];
    expect(screenCanvas).toBe("screen@6");
    expect(sourceTs).toBe(6);
    expect(outTs).toBe(4);
    expect(slide).not.toHaveBeenCalled();
    const still = posted.find((m) => m.type === "still")!;
    expect(still).toMatchObject({ width: 1920, height: 1080 });
    expect(new Uint8Array(still.data as ArrayBuffer)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    // Only the source-size canvas exists: no GIF-size downscale target.
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 1920, height: 1080, blobType: "image/png" });
  });

  it("hands redactions and overlay windows to the composer", async () => {
    await runWorker(message(4));
    expect(createOutputComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        redactions: PLAN.redactions,
        overlayWindows: PLAN.overlayWindows,
        width: 1920,
        height: 1080,
      }),
    );
  });

  it("composes a slide at the playhead through composer.slide", async () => {
    await runWorker(message(1));
    expect(slide).toHaveBeenCalledWith("slide-bitmap", 1);
    expect(clip).not.toHaveBeenCalled();
    expect(posted.some((m) => m.type === "still")).toBe(true);
  });

  it("gives the clip frame its webcam frame", async () => {
    await runWorker(message(4, { ...PLAN, webcam: { layout: WEBCAM_DEFAULTS, segments: [] } }));
    expect(clip.mock.calls[0][4]).toEqual({
      image: { image: "face", width: 1, height: 1 },
      sourceTs: 6,
    });
  });

  it("fails instead of returning a stale black frame when nothing decodes", async () => {
    sinkState.nothingDecodable = true;
    await runWorker(message(4));
    expect(posted.find((m) => m.type === "error")?.message).toMatch(/no decodable frame/);
    expect(posted.some((m) => m.type === "still")).toBe(false);
  });
});

// ADR 0058: a still decodes the recording under the playhead at that file's own seconds and
// composes at axis seconds. Opened clips 0-10 and 50-60; joined "b" at axis 3600 (clip 3600-3610).
describe("gif-worker still mode over a joined recording", () => {
  const OPENED = new Blob(["opened"]);
  const JOINED_B = new Blob(["b"]);
  const TWO = {
    segments: [
      {
        kind: "clip",
        timelineStart: 0,
        duration: 10,
        sourceStart: 0,
        sourceEnd: 10,
        sourceId: null,
      },
      {
        kind: "clip",
        timelineStart: 10,
        duration: 10,
        sourceStart: 3600,
        sourceEnd: 3610,
        sourceId: "b",
      },
    ],
    totalDuration: 20,
    redactions: [],
    overlayWindows: [],
    webcam: null,
  } as unknown as ExportPlan;

  it("decodes B's file at its local second and composes at the axis second", async () => {
    const msg = {
      ...message(15, TWO),
      // No frame reads the opened recording: its file is not sent.
      sourceBlob: null,
      joined: [{ sourceId: "b", offset: 3600, blob: JOINED_B, webcam: null }],
    } as GifStartMessage;
    await runWorker(msg);
    expect(decodes).toEqual([{ blob: JOINED_B, times: [5] }]);
    const [screenCanvas, sourceTs, , outTs] = clip.mock.calls[0];
    expect(screenCanvas).toBe("screen@5");
    expect(sourceTs).toBe(3605);
    expect(outTs).toBe(15);
    expect(posted.some((m) => m.type === "still")).toBe(true);
  });

  it("decodes the opened recording at the axis second when the playhead is in it", async () => {
    const msg = {
      ...message(4, TWO),
      sourceBlob: OPENED,
      joined: [{ sourceId: "b", offset: 3600, blob: JOINED_B, webcam: null }],
    } as GifStartMessage;
    await runWorker(msg);
    expect(decodes).toEqual([{ blob: OPENED, times: [4] }]);
    expect(clip.mock.calls[0][1]).toBe(4);
  });
});
