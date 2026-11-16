import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { ExportPlan } from "./export-plan";
import type { GifStartMessage } from "./gif-messages";

// The GIF worker, run for real on its message handler (review E7: a wiring test instead of
// a regex over its source). WebCodecs, the encoder and the composer's canvas work are faked
// at the module boundary; what is exercised is the worker's own wiring: the plan's webcam
// reaches the composer, and each sampled frame gets the webcam frame due at its source time.

const { clip, createOutputComposer, framesAt, screen, decodes, webcamOpens } = vi.hoisted(() => {
  const clip = vi.fn();
  return {
    clip,
    createOutputComposer: vi.fn(() => ({ clip, slide: vi.fn() })),
    framesAt: vi.fn(),
    // The last source time the screen has a new frame at; past it the sink returns that
    // frame again, as for a still screen. Infinity: a new frame at every sampled time.
    screen: { stillFrom: Infinity },
    // Every `canvasesAtTimestamps` call: the file whose sink decoded, and the times asked.
    decodes: [] as Array<{ blob: unknown; times: number[] }>,
    // The file each webcam source was opened on.
    webcamOpens: [] as unknown[],
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
        const at = Math.min(t, screen.stillFrom);
        yield { canvas: `screen@${at}`, timestamp: at, duration: 1 / 30 };
      }
    }
  },
}));
vi.mock("./webcam-source", () => ({
  openWebcamSourceOrNone: vi.fn(async (file: unknown, scene: WebcamScene | null) => {
    if (!scene || !file) return null;
    webcamOpens.push((file as { blob: Blob }).blob);
    return {
      framesAt: (times: number[]) => framesAt(times, (file as { blob: Blob }).blob),
      dispose: vi.fn(),
    };
  }),
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
    joined: [],
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
  screen.stillFrom = Infinity;
  clip.mockClear();
  decodes.length = 0;
  webcamOpens.length = 0;
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

  it("over a still screen the crop follows the sampled time; the held frame keeps its own (E9)", async () => {
    screen.stillFrom = 5.5;
    await runWorker(message(LAYER));
    const held = clip.mock.calls.filter((c) => 5 + (c[3] as number) > 5.5 + 1e-6);
    expect(held.length).toBeGreaterThan(0);
    for (const [screenCanvas, sourceTs, , outTs, webcamFrame, cameraTs] of held) {
      // The held frame and its span (so its redactions) stay those of source 5.5 s...
      expect(screenCanvas).toBe("screen@5.5");
      expect(sourceTs).toBe(5.5);
      // ...while the face, its layout and the camera crop all read the sampled time.
      expect(webcamFrame).toEqual({ image: WEBCAM_IMAGE, sourceTs: cameraTs });
      expect(cameraTs).toBeCloseTo(5 + outTs);
    }
  });

  it("without a webcam layer, composes with none and opens no webcam decoder", async () => {
    await runWorker(message(null));
    expect(createOutputComposer).toHaveBeenCalledWith(expect.objectContaining({ webcam: null }));
    expect(framesAt).not.toHaveBeenCalled();
    expect(clip.mock.calls.every((c) => c[4] === null)).toBe(true);
  });
});

// ADR 0058: the opened recording is [0, 100] on the axis (clips 0-10 and 50-60), a joined
// recording "b" starts at axis 3600 (clip 3600-3610). A frame decodes from ITS recording at
// local seconds and is composed at axis seconds.
describe("gif-worker over two recordings", () => {
  const OPENED = new Blob(["opened"]);
  const JOINED_B = new Blob(["b"]);
  const CAM_OPENED = new Blob(["cam-opened"]);
  const CAM_B = new Blob(["cam-b"]);

  function twoRecordings(): GifStartMessage {
    const plan = {
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
        {
          kind: "clip",
          timelineStart: 20,
          duration: 10,
          sourceStart: 50,
          sourceEnd: 60,
          sourceId: null,
        },
      ],
      totalDuration: 30,
      redactions: [],
      overlayWindows: [],
      webcam: LAYER,
    } as unknown as ExportPlan;
    return {
      ...message(null),
      plan,
      sourceBlob: OPENED,
      webcam: { blob: CAM_OPENED, startOffsetMs: 0 },
      joined: [
        { sourceId: "b", offset: 3600, blob: JOINED_B, webcam: { blob: CAM_B, startOffsetMs: 0 } },
      ],
    } as GifStartMessage;
  }

  it("decodes a frame inside B from B's file at local 0-10 and composes it at axis 3600+", async () => {
    await runWorker(twoRecordings());
    const inB = decodes.filter((d) => d.blob === JOINED_B);
    expect(inB.length).toBeGreaterThan(0);
    for (const call of inB) {
      for (const time of call.times) {
        expect(time).toBeGreaterThanOrEqual(0);
        expect(time).toBeLessThanOrEqual(10);
      }
    }
    const composedInB = clip.mock.calls.filter((c) => (c[1] as number) >= 3600);
    expect(composedInB.length).toBe(inB.flatMap((d) => d.times).length);
    for (const [screenCanvas, sourceTs, , outTs] of composedInB) {
      // Local second in the file, axis second for the composer, the timeline's own clock out.
      expect(screenCanvas).toBe(`screen@${(sourceTs as number) - 3600}`);
      expect(outTs as number).toBeGreaterThanOrEqual(10);
      expect(outTs as number).toBeLessThanOrEqual(20);
      expect(sourceTs).toBeCloseTo(3600 + (outTs as number) - 10);
    }
  });

  it("decodes the opened recording's clips from its own file at the same seconds as before", async () => {
    await runWorker(twoRecordings());
    const fromOpened = decodes.filter((d) => d.blob === OPENED).flatMap((d) => d.times);
    expect(fromOpened.length).toBeGreaterThan(0);
    const composedOpened = clip.mock.calls.filter((c) => (c[1] as number) < 3600);
    expect(composedOpened.map((c) => c[1])).toEqual(fromOpened);
    expect(fromOpened.every((t) => t <= 10 || (t >= 50 && t <= 60))).toBe(true);
  });

  it("looks the webcam frame of a clip in B up in B's own webcam file at local seconds", async () => {
    await runWorker(twoRecordings());
    expect(webcamOpens).toEqual([CAM_OPENED, CAM_B]);
    const askedOfB = framesAt.mock.calls
      .filter((c) => c[1] === CAM_B)
      .flatMap((c) => c[0] as number[]);
    expect(askedOfB.length).toBeGreaterThan(0);
    expect(askedOfB.every((t) => t >= 0 && t <= 10)).toBe(true);
    // The composer still gets the AXIS second to pick the layout and the camera scale.
    const composedInB = clip.mock.calls.filter((c) => (c[1] as number) >= 3600);
    expect(composedInB.every((c) => (c[4] as { sourceTs: number }).sourceTs >= 3600)).toBe(true);
  });
});
