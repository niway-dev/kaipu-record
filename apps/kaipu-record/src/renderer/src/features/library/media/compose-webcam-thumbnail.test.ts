import { describe, expect, it, vi } from "vitest";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import type { WebcamImage } from "@renderer/features/video-editor/export/compose-webcam";
import type { WebcamSource } from "@renderer/features/video-editor/export/webcam-source";
import { composeWebcamThumbnail, type ComposeIo } from "./compose-webcam-thumbnail";

const SCREEN = {
  image: { tag: "screen" } as unknown as CanvasImageSource,
  width: 1000,
  height: 500,
};
const FACE: WebcamImage = {
  image: { tag: "face" } as unknown as CanvasImageSource,
  width: 1280,
  height: 720,
};

const meta = (patch: Partial<WebcamTrackMeta> = {}): WebcamTrackMeta => ({
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
  recordedLayout: {
    shape: "circle",
    size: 240,
    cornerRadius: 18,
    mirrored: false,
    framing: { enabled: false, zoom: 1, x: 0, y: 0 },
    position: { x: 0.5, y: 0.5 },
    sizeFraction: 0.25,
  },
  ...patch,
});

/** A canvas whose context records every call, in order. */
function harness(frames: Array<WebcamImage | null>) {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) =>
      key in state ? state[key] : (...args: unknown[]) => void log.push([key, ...args]),
    set: (_t, key: string, value) => {
      state[key] = value;
      return true;
    },
  });
  const asked: number[][] = [];
  const source: WebcamSource = {
    duration: 10,
    cursorFor: () => {
      throw new Error("not used");
    },
    async *framesAt(times) {
      asked.push(times);
      for (let i = 0; i < times.length; i++) yield frames[asked.length - 1] ?? null;
    },
    dispose: vi.fn(),
  };
  const encoded = new ArrayBuffer(4);
  const created: Array<[number, number]> = [];
  const io: ComposeIo = {
    loadScreen: vi.fn(async () => SCREEN),
    openWebcam: vi.fn(async () => source),
    createCanvas: (width, height) => {
      created.push([width, height]);
      return { ctx: ctx as never, encode: async () => encoded };
    },
  };
  return { io, log, asked, source, encoded, created };
}

describe("composeWebcamThumbnail", () => {
  it("draws the screen at its own size, then the bubble at the recorded layout's rectangle", async () => {
    const h = harness([FACE]);

    const out = await composeWebcamThumbnail({ id: "rec", screenUrl: "u", webcam: meta() }, h.io);

    expect(out).toBe(h.encoded);
    expect(h.created).toEqual([[1000, 500]]); // the thumbnail keeps its size
    const draws = h.log.filter(([name]) => name === "drawImage");
    expect(draws[0]).toEqual(["drawImage", SCREEN.image, 0, 0, 1000, 500]);
    // The bubble: 25 % of the 500 px height, square for a circle, centred at (0.5, 0.5).
    expect(draws[1]).toEqual(["drawImage", FACE.image, 280, 0, 720, 720, 437.5, 187.5, 125, 125]);
    expect(h.source.dispose).toHaveBeenCalledOnce();
  });

  it("asks for the frame shown ~150 ms into the take, and for the first frame when that fails", async () => {
    const h = harness([null, FACE]);

    await composeWebcamThumbnail(
      { id: "rec", screenUrl: "u", webcam: meta({ startOffsetMs: 200 }) },
      h.io,
    );

    // framesAt takes screen (source) seconds; the webcam file's time 0 is at 0.2 s.
    expect(h.asked).toEqual([[0.15], [0.2]]);
  });

  it("draws the bubble even when the camera was off at 150 ms (the take used the webcam)", async () => {
    const h = harness([FACE]);

    await composeWebcamThumbnail(
      {
        id: "rec",
        screenUrl: "u",
        webcam: meta({ gaps: [{ startMs: 0, endMs: 5000 }] }),
      },
      h.io,
    );

    expect(h.log.filter(([name]) => name === "drawImage")).toHaveLength(2);
  });

  it("rejects, and still releases the decoder, when the webcam file has no frame to show", async () => {
    const h = harness([null, null]);

    await expect(
      composeWebcamThumbnail({ id: "rec", screenUrl: "u", webcam: meta() }, h.io),
    ).rejects.toThrow(/frame/i);
    expect(h.source.dispose).toHaveBeenCalledOnce();
  });
});
