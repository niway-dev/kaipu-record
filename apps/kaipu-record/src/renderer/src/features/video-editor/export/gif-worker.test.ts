import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { ExportPlan } from "./export-plan";
import type { GifStartMessage } from "./gif-messages";

// The GIF worker, run for real on its message handler (review E7: a wiring test instead of
// a regex over its source). WebCodecs, the encoder and the composer's canvas work are faked
// at the module boundary; what is exercised is the worker's own wiring: the plan's webcam
// reaches the composer, and each sampled frame gets the webcam frame due at its source time.

const { clip, createOutputComposer, framesAt } = vi.hoisted(() => {
  const clip = vi.fn();
  return {
    clip,
    createOutputComposer: vi.fn(() => ({ clip, slide: vi.fn() })),
    framesAt: vi.fn(),
  };
});

vi.mock("./compose-output-frame", () => ({ createOutputComposer }));
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class {
    getPrimaryVideoTrack = async () => ({});
    dispose(): void {}
  },
  CanvasSink: class {
    async *canvasesAtTimestamps(times: number[]) {
      for (const t of times) yield { canvas: `screen@${t}`, timestamp: t, duration: 1 / 30 };
    }
  },
}));
vi.mock("./webcam-source", () => ({
  openWebcamSourceOrNone: vi.fn(async (_file: unknown, scene: WebcamScene | null) =>
    scene ? { framesAt, dispose: vi.fn() } : null,
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
  ) {}
  getContext() {
    return new Proxy(
      {},
      {
        get: (_t, key) =>
          key === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {},
        set: () => true,
      },
    );
  }
}

const WEBCAM_IMAGE = { image: "face", width: 1280, height: 720 };
const LAYER: WebcamScene = { layout: WEBCAM_DEFAULTS, segments: [] };

function message(webcam: WebcamScene | null): GifStartMessage {
  // One clip: timeline 0–2 s is source 5–7 s.
  const plan = {
    segments: [{ kind: "clip", timelineStart: 0, duration: 2, sourceStart: 5, sourceEnd: 7 }],
    totalDuration: 2,
    redactions: [],
    overlayWindows: [],
    webcam,
  } as unknown as ExportPlan;
  return {
    type: "start",
    mode: "estimate",
    sourceBlob: new Blob(["x"]),
    plan,
    overlays: [],
    slides: [],
    source: { width: 1920, height: 1080 },
    output: { width: 640, height: 360 },
    fps: 10,
    camera: null,
    webcam: webcam ? { blob: new Blob(["cam"]), startOffsetMs: 0 } : null,
  } as GifStartMessage;
}

let posted: unknown[] = [];

async function runWorker(msg: GifStartMessage): Promise<void> {
  vi.resetModules();
  await import("./gif-worker");
  const handler = (self as unknown as { onmessage: (e: MessageEvent) => void }).onmessage;
  handler({ data: msg } as MessageEvent);
  await vi.waitFor(() =>
    expect(posted.some((m) => (m as { type: string }).type === "estimate")).toBe(true),
  );
}

beforeEach(() => {
  posted = [];
  clip.mockClear();
  createOutputComposer.mockClear();
  framesAt.mockReset();
  framesAt.mockImplementation(async function* (times: number[]) {
    for (const _t of times) yield WEBCAM_IMAGE;
  });
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.spyOn(self, "postMessage").mockImplementation((m: unknown) => void posted.push(m));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gif-worker wiring", () => {
  it("hands the plan's webcam to the composer, and each frame the webcam frame at its source time", async () => {
    await runWorker(message(LAYER));
    expect(createOutputComposer).toHaveBeenCalledWith(expect.objectContaining({ webcam: LAYER }));
    expect(clip).toHaveBeenCalled();
    for (const [screenCanvas, sourceTs, , outTs, webcamFrame] of clip.mock.calls) {
      expect(screenCanvas).toBe(`screen@${sourceTs}`);
      // Timeline t is source 5 + t: the frame and its face are looked up at the same time.
      expect(sourceTs).toBeCloseTo(5 + outTs);
      expect(webcamFrame).toEqual({ image: WEBCAM_IMAGE, sourceTs });
    }
    expect(framesAt.mock.calls[0]![0]).toEqual(clip.mock.calls.map((c) => c[1]));
  });

  it("without a webcam layer, composes with none and opens no webcam decoder", async () => {
    await runWorker(message(null));
    expect(createOutputComposer).toHaveBeenCalledWith(expect.objectContaining({ webcam: null }));
    expect(framesAt).not.toHaveBeenCalled();
    expect(clip.mock.calls.every((c) => c[4] === null)).toBe(true);
  });
});
