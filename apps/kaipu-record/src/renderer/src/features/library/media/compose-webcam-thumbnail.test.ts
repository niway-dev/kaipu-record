import { describe, expect, it, vi } from "vitest";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import type { WebcamImage } from "@renderer/features/video-editor/export/compose-webcam";
import {
  clampIntoDuration,
  composeWebcamThumbnail,
  webcamFrameSeconds,
  type ComposeIo,
} from "./compose-webcam-thumbnail";

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

/** A canvas whose context records every call, in order; `frames` answers decode calls in turn. */
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
  const asked: number[] = [];
  const encoded = new ArrayBuffer(4);
  const created: Array<[number, number]> = [];
  const io: ComposeIo = {
    loadScreen: vi.fn(async () => SCREEN),
    decodeWebcamFrame: vi.fn(async (_input, seconds) => {
      asked.push(seconds);
      return frames[asked.length - 1] ?? null;
    }),
    createCanvas: (width, height) => {
      created.push([width, height]);
      return { ctx: ctx as never, encode: async () => encoded };
    },
  };
  return { io, log, asked, encoded, created };
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
  });

  it("decodes one frame at the webcam time of the take's ~150 ms", async () => {
    const h = harness([FACE]);

    await composeWebcamThumbnail({ id: "rec", screenUrl: "u", webcam: meta() }, h.io);
    expect(h.asked).toEqual([0.15]);

    const early = harness([FACE]);
    await composeWebcamThumbnail(
      { id: "rec", screenUrl: "u", webcam: meta({ startOffsetMs: 50 }) },
      early.io,
    );
    expect(early.asked[0]).toBeCloseTo(0.1, 6); // the webcam file began 50 ms into the take
  });

  it("asks for webcam time 0 when the webcam started after 150 ms, and once only", async () => {
    const h = harness([FACE]);

    await composeWebcamThumbnail(
      { id: "rec", screenUrl: "u", webcam: meta({ startOffsetMs: 200 }) },
      h.io,
    );

    expect(h.asked).toEqual([0]);
  });

  it("falls back to the first frame when the wanted one cannot be decoded", async () => {
    const h = harness([null, FACE]);

    await composeWebcamThumbnail({ id: "rec", screenUrl: "u", webcam: meta() }, h.io);

    expect(h.asked).toEqual([0.15, 0]);
    expect(h.log.filter(([name]) => name === "drawImage")).toHaveLength(2);
  });

  it("draws the bubble even when the camera was off at 150 ms (the take used the webcam)", async () => {
    const h = harness([FACE]);

    await composeWebcamThumbnail(
      { id: "rec", screenUrl: "u", webcam: meta({ gaps: [{ startMs: 0, endMs: 5000 }] }) },
      h.io,
    );

    expect(h.log.filter(([name]) => name === "drawImage")).toHaveLength(2);
  });

  it("rejects without drawing when the webcam file has no frame to show", async () => {
    const h = harness([null, null]);

    await expect(
      composeWebcamThumbnail({ id: "rec", screenUrl: "u", webcam: meta() }, h.io),
    ).rejects.toThrow(/frame/i);
    expect(h.log).toEqual([]);
  });
});

describe("webcamFrameSeconds", () => {
  it("is the take's 150 ms in the webcam file's timeline, never negative", () => {
    expect(webcamFrameSeconds(0)).toBeCloseTo(0.15, 6);
    expect(webcamFrameSeconds(100)).toBeCloseTo(0.05, 6);
    expect(webcamFrameSeconds(150)).toBe(0);
    expect(webcamFrameSeconds(2000)).toBe(0);
  });
});

describe("clampIntoDuration", () => {
  it("keeps a time inside [0, duration), and 0 for a file without a known duration", () => {
    expect(clampIntoDuration(0.15, 10)).toBe(0.15);
    expect(clampIntoDuration(-1, 10)).toBe(0);
    expect(clampIntoDuration(5, 0.1)).toBeLessThan(0.1);
    expect(clampIntoDuration(5, 0.1)).toBeGreaterThanOrEqual(0);
    expect(clampIntoDuration(5, 0)).toBe(0);
    expect(clampIntoDuration(5, Number.NaN)).toBe(0);
  });
});
