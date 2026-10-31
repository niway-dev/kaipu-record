import { describe, expect, it, vi } from "vitest";
import { WEBCAM_DEFAULTS, type WebcamScene } from "../webcam/webcam-model";
import type { WebcamImage } from "./compose-webcam";
import type { RenderClipSegment } from "./export-plan";
import { exportClipFrames, type ClipFrame } from "./export-clip-frames";
import { createFrameRateCap } from "./frame-rate-cap";
import { createWebcamCursor } from "./webcam-lockstep";

// The MP4 worker's per-clip loop over fakes (review E10): a synthetic screen sink, a real
// lockstep cursor over synthetic webcam frames, a recording composer and encoder.

interface Face {
  timestamp: number;
  name: string;
}

const screen = (timestamp: number, duration: number): ClipFrame & { name: string } => ({
  canvas: { tag: `screen@${timestamp}` } as unknown as CanvasImageSource,
  timestamp,
  duration,
  name: `screen@${timestamp}`,
});

async function* frames<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

/** A 30 fps webcam that started with the screen, `seconds` long. */
function webcamCursor(seconds: number) {
  const faces: Face[] = Array.from({ length: Math.round(seconds * 30) }, (_, i) => ({
    timestamp: i / 30,
    name: `face#${i}`,
  }));
  return createWebcamCursor(frames(faces), 0, seconds);
}

const imageOf = (face: Face | null): WebcamImage | null =>
  face ? { image: face.name as unknown as CanvasImageSource, width: 1280, height: 720 } : null;

const layer = (segments: WebcamScene["segments"] = []): WebcamScene => ({
  layout: WEBCAM_DEFAULTS,
  segments,
});

function run(opts: {
  segment: RenderClipSegment;
  screens: ClipFrame[];
  webcam?: { layer: WebcamScene; seconds: number } | null;
  maxFps?: number | null;
  prevOutTs?: number | null;
}) {
  const clip = vi.fn();
  const emitted: { outTs: number; duration: number }[] = [];
  const result = exportClipFrames({
    segment: opts.segment,
    frames: frames(opts.screens),
    webcamCursor: opts.webcam ? webcamCursor(opts.webcam.seconds) : null,
    layer: opts.webcam?.layer ?? null,
    webcamImageOf: imageOf,
    fillFps: 30,
    cap: createFrameRateCap(opts.maxFps ?? null),
    minFrameGap: opts.maxFps ? 1 / opts.maxFps : 0,
    prevOutTs: opts.prevOutTs ?? null,
    compose: { clip },
    emit: async (outTs, duration) => void emitted.push({ outTs, duration }),
  });
  return { result, clip, emitted };
}

const SEGMENT: RenderClipSegment = {
  kind: "clip",
  timelineStart: 10,
  duration: 2,
  sourceStart: 4,
  sourceEnd: 6,
};

describe("exportClipFrames", () => {
  it("without a webcam, encodes each screen frame at its rebased output time", async () => {
    const { result, clip, emitted } = run({
      segment: SEGMENT,
      screens: [screen(4, 1), screen(5, 1)],
    });
    expect(await result).toBe(11);
    expect(emitted.map((e) => e.outTs)).toEqual([10, 11]);
    expect(clip.mock.calls.map((c) => [c[3], c[4]])).toEqual([
      [10, null],
      [11, null],
    ]);
  });

  it("hands each kept frame the webcam frame due at its source time (the wiring E7 asked for)", async () => {
    const { result, clip } = run({
      segment: SEGMENT,
      screens: [screen(4, 1 / 30), screen(4 + 1 / 30, 1 / 30)],
      webcam: { layer: layer(), seconds: 10 },
    });
    await result;
    const first = clip.mock.calls[0]!;
    expect(first[0]).toEqual({ tag: "screen@4" });
    expect(first[4]).toEqual({
      image: { image: "face#120", width: 1280, height: 720 },
      sourceTs: 4,
    });
  });

  it("looks the straddling first frame's face up at the clip's start, not in cut footage", async () => {
    const { result, clip } = run({
      segment: SEGMENT,
      screens: [screen(3.5, 1)],
      webcam: { layer: layer(), seconds: 10 },
    });
    await result;
    expect(clip.mock.calls[0]![4]).toMatchObject({ sourceTs: 4 });
  });

  it("over a still screen, fills the gap at the webcam's rate with the held frame, cropped at the fill's time", async () => {
    // One screen frame at 4 s, then nothing until 4.2 s: the face must keep moving.
    const { result, clip, emitted } = run({
      segment: SEGMENT,
      screens: [screen(4, 0.2), screen(4.2, 1 / 30)],
      webcam: { layer: layer(), seconds: 10 },
    });
    await result;
    const fills = clip.mock.calls.filter((c) => c[0].tag === "screen@4").slice(1);
    expect(fills.length).toBeGreaterThanOrEqual(4);
    for (const fill of fills) {
      // The held frame's own span, and the camera time = the fill's source time (E9).
      expect(fill[1]).toBe(4);
      expect(fill[5]).toBeCloseTo(fill[4].sourceTs);
    }
    const outTimes = emitted.map((e) => e.outTs);
    expect(outTimes).toEqual([...outTimes].sort((a, b) => a - b));
  });

  it("does not fill while the layer is hidden: the held frame stays as is", async () => {
    const { result, clip } = run({
      segment: SEGMENT,
      screens: [screen(4, 1), screen(5, 1)],
      webcam: { layer: layer([{ id: "h", start: 3, end: 7, mode: "hidden" }]), seconds: 10 },
    });
    await result;
    expect(clip).toHaveBeenCalledTimes(2);
  });

  it("fills the last frame of the clip up to the clip's end, and the last fill lasts until it", async () => {
    const { result, emitted } = run({
      segment: SEGMENT,
      screens: [screen(4, 2)],
      webcam: { layer: layer(), seconds: 10 },
    });
    const last = await result;
    expect(last).toBeGreaterThan(11.9);
    const final = emitted[emitted.length - 1]!;
    expect(final.outTs + final.duration).toBeCloseTo(12);
  });

  it("keeps fills and frames inside the fps cap", async () => {
    const { result, emitted } = run({
      segment: SEGMENT,
      screens: [screen(4, 1), screen(5, 1)],
      webcam: { layer: layer(), seconds: 10 },
      maxFps: 24,
    });
    await result;
    const slots = emitted.map((e) => Math.round(e.outTs * 24));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("threads prevOutTs across a cut: a frame that would regress is skipped", async () => {
    const { result, emitted } = run({
      segment: SEGMENT,
      screens: [screen(3.9, 0.2), screen(4.5, 0.5)],
      prevOutTs: 10,
    });
    expect(await result).toBe(10.5);
    expect(emitted.map((e) => e.outTs)).toEqual([10.5]);
  });
});
