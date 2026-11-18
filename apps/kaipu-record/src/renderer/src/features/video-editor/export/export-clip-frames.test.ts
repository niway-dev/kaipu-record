import { describe, expect, it, vi } from "vitest";
import {
  WEBCAM_DEFAULTS,
  webcamStateAt,
  type WebcamScene,
  type WebcamTransition,
} from "../webcam/webcam-model";
import { planWebcamDraw, type WebcamImage } from "./compose-webcam";
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

/** A webcam (30 fps unless told) that started with the screen, `seconds` long. */
function webcamCursor(seconds: number, fps = 30) {
  const faces: Face[] = Array.from({ length: Math.round(seconds * fps) }, (_, i) => ({
    timestamp: i / fps,
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
  webcam?: { layer: WebcamScene; seconds: number; fps?: number } | null;
  maxFps?: number | null;
  prevOutTs?: number | null;
  /** The recording's end in source seconds (the plan's `sourceDurationSeconds`). */
  recordingEnd?: number;
  floatingLive?: (outTs: number) => boolean;
}) {
  const clip = vi.fn();
  const emitted: { outTs: number; duration: number }[] = [];
  const result = exportClipFrames({
    segment: opts.segment,
    frames: frames(opts.screens),
    webcamCursor: opts.webcam ? webcamCursor(opts.webcam.seconds, opts.webcam.fps) : null,
    layer: opts.webcam?.layer ?? null,
    webcamImageOf: imageOf,
    fillFps: 30,
    cap: createFrameRateCap(opts.maxFps ?? null),
    minFrameGap: opts.maxFps ? 1 / opts.maxFps : 0,
    prevOutTs: opts.prevOutTs ?? null,
    sourceEndSeconds: opts.recordingEnd,
    floatingLive: opts.floatingLive,
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
  sourceId: null,
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

  describe("floating images over a still screen, no webcam", () => {
    // Illustrative: floating items are on screen from output 10.5 to 11.0 (the clip is 10..12).
    const live = (outTs: number): boolean => outTs >= 10.5 && outTs < 11;

    it("composes the held frame while an item is on screen, and once more to remove it", async () => {
      // One screen frame for the whole clip: without fills the item is never drawn.
      const { result, clip, emitted } = run({
        segment: SEGMENT,
        screens: [screen(4, 2)],
        floatingLive: live,
      });
      await result;
      const outTimes = emitted.map((e) => e.outTs);
      expect(outTimes[0]).toBe(10);
      const during = outTimes.filter((t) => t >= 10.5 && t < 11);
      expect(during.length).toBeGreaterThanOrEqual(10);
      // The first frame after the item ends redraws without it.
      expect(outTimes.some((t) => t >= 11 && t < 11.1)).toBe(true);
      // Nothing else is added: still frames stay as one sample outside the item's span.
      expect(outTimes.filter((t) => t > 10 && t < 10.5 - 1 / 30)).toEqual([]);
      expect(outTimes.filter((t) => t > 11.1)).toEqual([]);
      for (const call of clip.mock.calls) expect(call[0]).toEqual({ tag: "screen@4" });
      expect(outTimes).toEqual([...outTimes].sort((a, b) => a - b));
    });

    it("adds nothing without floating items", async () => {
      const { result, emitted } = run({ segment: SEGMENT, screens: [screen(4, 2)] });
      await result;
      expect(emitted).toHaveLength(1);
    });
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

// Camera sections (ADR 0039, spec decision 6): a slide over a still screen must not freeze.
describe("exportClipFrames — a camera section's slide", () => {
  const FRAME = { width: 1920, height: 1080 };
  const IMAGE = { width: 1280, height: 720 };
  const SLIDE: WebcamTransition = { kind: "slide", ms: 700, easing: "back" };
  const sceneWithBlock = (start: number): WebcamScene => ({
    layout: WEBCAM_DEFAULTS,
    segments: [
      {
        id: "b",
        start,
        end: start + 5,
        mode: "override",
        layout: { position: { x: 0.88, y: 0.18 } },
        transition: SLIDE,
      },
    ],
  });
  /** The bubble's box the composer would draw for one `clip` call. */
  const rectOf = (call: unknown[], layer: WebcamScene) => {
    const face = call[4] as { sourceTs: number } | null;
    return face ? planWebcamDraw(layer, face.sourceTs, FRAME, 1, IMAGE)!.rect : null;
  };

  it("emits a frame per fill with a distinct bubble position while it moves, though the webcam frame is the same", async () => {
    const layer = sceneWithBlock(4.5);
    // One screen frame held for the whole 2 s clip, and a 10 fps webcam: it changes only
    // every 0.1 s, so only a `moving` fill can put a frame in between.
    const { result, clip } = run({
      segment: SEGMENT,
      screens: [screen(4, 2)],
      webcam: { layer, seconds: 10, fps: 10 },
    });
    await result;
    const sliding = clip.mock.calls.filter((c) => {
      const t = (c[4] as { sourceTs: number } | null)?.sourceTs ?? -1;
      return webcamStateAt({ webcam: layer }, t)?.from;
    });
    // 0.7 s at 30 fps is about 20 fills, against 7 webcam frames.
    expect(sliding.length).toBeGreaterThanOrEqual(19);
    const xs = sliding.map((c) => rectOf(c, layer)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).not.toBeCloseTo(xs[i - 1]!, 3);
  });

  it("outside a transition the skip still holds: no frame when the webcam frame is unchanged", async () => {
    const layer = sceneWithBlock(4.5);
    const { result, clip } = run({
      segment: SEGMENT,
      screens: [screen(4, 2)],
      webcam: { layer, seconds: 10, fps: 10 },
    });
    await result;
    const before = clip.mock.calls.filter(
      (c) => ((c[4] as { sourceTs: number } | null)?.sourceTs ?? 0) < 4.5,
    );
    // The screen frame itself, then one fill per new 10 fps webcam frame (4.1 .. 4.4).
    expect(before.length).toBeLessThanOrEqual(6);
    const after = clip.mock.calls.filter(
      (c) => ((c[4] as { sourceTs: number } | null)?.sourceTs ?? 0) >= 5.2 + 1 / 30,
    );
    // From 5.23 to 6 at 10 fps: eight new webcam frames at most.
    expect(after.length).toBeLessThanOrEqual(8);
  });

  it("trimming 30 s before a block makes its slide start 30 s earlier in the output", async () => {
    const layer = sceneWithBlock(34);
    const firstMove = async (segment: RenderClipSegment): Promise<number> => {
      const { result, clip } = run({
        segment,
        screens: [screen(segment.sourceStart, segment.duration)],
        webcam: { layer, seconds: 50, fps: 10 },
      });
      await result;
      const call = clip.mock.calls.find((c) => {
        const t = (c[4] as { sourceTs: number } | null)?.sourceTs ?? -1;
        return webcamStateAt({ webcam: layer }, t)?.from;
      })!;
      return call[3] as number;
    };
    const whole = await firstMove({
      kind: "clip",
      timelineStart: 0,
      duration: 40,
      sourceStart: 0,
      sourceEnd: 40,
      sourceId: null,
    });
    const trimmed = await firstMove({
      kind: "clip",
      timelineStart: 0,
      duration: 10,
      sourceStart: 30,
      sourceEnd: 40,
      sourceId: null,
    });
    expect(whole).toBeCloseTo(34, 1);
    expect(trimmed).toBeCloseTo(4, 1);
    expect(whole - trimmed).toBeCloseTo(30, 1);
  });

  describe("the last block's return, capped by the recording's end", () => {
    // The block ends at 5.7 s and the recording at 6 s: the 700 ms return gets half the
    // 0.3 s gap, 150 ms, and is settled at 5.85 s.
    const lastBlock = (): WebcamScene => ({
      layout: WEBCAM_DEFAULTS,
      segments: [
        {
          id: "b",
          start: 4.2,
          end: 5.7,
          mode: "override",
          layout: { position: { x: 0.88, y: 0.18 } },
          transition: SLIDE,
        },
      ],
    });
    const times = (calls: unknown[][], from: number, to: number): number[] =>
      calls
        .map((c) => (c[4] as { sourceTs: number } | null)?.sourceTs ?? -1)
        .filter((t) => t >= from && t < to);

    it("emits the return's frames only until the capped return finishes, at the preview's places", async () => {
      const layer = lastBlock();
      const { result, clip } = run({
        segment: SEGMENT,
        screens: [screen(4, 2)],
        webcam: { layer, seconds: 10, fps: 10 },
        recordingEnd: 6,
      });
      await result;
      // 150 ms at 30 fps: five fills (5.70 .. 5.83), each in a distinct place.
      const returning = clip.mock.calls.filter((c) => {
        const t = (c[4] as { sourceTs: number } | null)?.sourceTs ?? -1;
        return t >= 5.7 && t < 5.85;
      });
      expect(returning.length).toBeGreaterThanOrEqual(4);
      expect(returning.length).toBeLessThanOrEqual(6);
      const xs = returning.map(
        (c) =>
          planWebcamDraw(layer, (c[4] as { sourceTs: number }).sourceTs, FRAME, 1, IMAGE, 6)!.rect
            .x,
      );
      for (let i = 1; i < xs.length; i++) expect(xs[i]).not.toBeCloseTo(xs[i - 1]!, 3);
      // After it, only the 10 fps webcam's own frames: at most 2 in the last 0.15 s.
      expect(times(clip.mock.calls, 5.85 + 1 / 30, 6).length).toBeLessThanOrEqual(2);
      // Every drawn place is the one the preview's function gives with the same end.
      for (const c of clip.mock.calls) {
        const t = (c[4] as { sourceTs: number } | null)?.sourceTs;
        if (t === undefined) continue;
        const state = webcamStateAt({ webcam: layer }, t, 6)!;
        expect(state.from !== null).toBe((t >= 5.7 && t < 5.85) || (t >= 4.2 && t < 4.9));
      }
    });

    it("without the recording's end the return keeps its whole 700 ms", async () => {
      const layer = lastBlock();
      const { result, clip } = run({
        segment: SEGMENT,
        screens: [screen(4, 2)],
        webcam: { layer, seconds: 10, fps: 10 },
      });
      await result;
      // Still sliding at the clip's end: the fills at 5.90, 5.93 and 5.97 move the bubble.
      expect(times(clip.mock.calls, 5.85 + 1 / 30, 6).length).toBeGreaterThanOrEqual(3);
    });
  });
});
