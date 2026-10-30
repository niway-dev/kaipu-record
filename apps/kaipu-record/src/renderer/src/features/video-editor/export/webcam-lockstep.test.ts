import { describe, expect, it, vi } from "vitest";
import {
  createWebcamCursor,
  fillWebcamGap,
  webcamDecodeWindow,
  webcamFillTimes,
  webcamLookupTime,
  WEBCAM_DECODE_LEAD,
} from "./webcam-lockstep";

interface Frame {
  index: number;
  timestamp: number;
}

/**
 * A synthetic webcam track decoded like mediabunny's `CanvasSink.canvases(start, end)`: the
 * frame straddling `start` first, then every frame up to `end`. `pulled` counts what was
 * read, to prove the cursor never reads past what it needs.
 */
function webcamTrack(fps: number, duration: number) {
  const count = Math.round(duration * fps);
  const stats = { pulled: 0 };
  async function* frames(start: number, end: number): AsyncGenerator<Frame> {
    const first = Math.max(0, Math.floor(start * fps + 1e-9));
    for (let index = first; index < count; index++) {
      const timestamp = index / fps;
      if (index > first && timestamp >= end) return;
      stats.pulled++;
      yield { index, timestamp };
    }
  }
  return { frames, stats, duration };
}

/** Screen frame timestamps at `fps` over source [start, end). */
const screenTimes = (fps: number, start: number, end: number): number[] => {
  const out: number[] = [];
  for (let i = Math.ceil(start * fps - 1e-9); i / fps < end - 1e-9; i++) out.push(i / fps);
  return out;
};

/** Runs one clip segment the way the MP4 worker does and returns the webcam frame per output frame. */
async function lockstep(
  track: ReturnType<typeof webcamTrack>,
  segment: { sourceStart: number; sourceEnd: number },
  startOffsetMs: number,
  screenFps: number,
): Promise<Array<number | null>> {
  const window = webcamDecodeWindow(
    segment.sourceStart,
    segment.sourceEnd,
    startOffsetMs,
    track.duration,
  );
  const cursor = createWebcamCursor<Frame>(
    window ? track.frames(window.start, window.end) : null,
    startOffsetMs,
    track.duration,
  );
  const picked: Array<number | null> = [];
  for (const t of screenTimes(screenFps, segment.sourceStart, segment.sourceEnd)) {
    picked.push((await cursor.frameAt(t))?.index ?? null);
  }
  await cursor.close();
  return picked;
}

describe("createWebcamCursor (lockstep, failure 8)", () => {
  it("holds each 30 fps webcam frame for two 60 fps screen frames", async () => {
    const track = webcamTrack(30, 2);
    const picked = await lockstep(track, { sourceStart: 0, sourceEnd: 0.2 }, 0, 60);
    expect(picked).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("matches frame for frame at 30 fps on both sides", async () => {
    const track = webcamTrack(30, 2);
    expect(await lockstep(track, { sourceStart: 0, sourceEnd: 0.2 }, 0, 30)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it("shifts by the start offset: a webcam that started 100 ms late shows nothing before it", async () => {
    const track = webcamTrack(30, 2);
    // Webcam time = source − 0.1 s: frames before 0.1 s have no webcam frame yet.
    const picked = await lockstep(track, { sourceStart: 0, sourceEnd: 0.2 }, 100, 60);
    expect(picked).toEqual([null, null, null, null, null, null, 0, 0, 1, 1, 2, 2]);
  });

  it("never shows a frame before its time (holds the last one whose timestamp + offset ≤ t)", async () => {
    const track = webcamTrack(30, 2);
    // 40 ms offset: screen 0.1 s → webcam 0.06 s, still frame 1 (0.0333…): frame 2 starts at
    // 0.0667 and only shows from screen 0.1067 on, i.e. on the next screen frame (0.1167).
    const picked = await lockstep(track, { sourceStart: 0.1, sourceEnd: 0.15 }, 40, 60);
    expect(picked).toEqual([1, 2, 2]);
  });

  it("follows a cut: the next clip resumes at its own source time, not where the last stopped", async () => {
    const track = webcamTrack(30, 10);
    const first = await lockstep(track, { sourceStart: 1, sourceEnd: 1.1 }, 0, 60);
    const second = await lockstep(track, { sourceStart: 5, sourceEnd: 5.1 }, 0, 60);
    expect(first).toEqual([30, 30, 31, 31, 32, 32]);
    expect(second).toEqual([150, 150, 151, 151, 152, 152]);
  });

  it("maps across a pause gap by source time alone (both files paused together)", async () => {
    // A 5 s pause leaves no gap in either file's timestamps: source 3 s is webcam 3 s − offset.
    const track = webcamTrack(30, 10);
    expect(await lockstep(track, { sourceStart: 3, sourceEnd: 3.05 }, 200, 60)).toEqual([
      84, 84, 85,
    ]);
  });

  it("shows nothing after the webcam's last frame", async () => {
    const track = webcamTrack(30, 1);
    const picked = await lockstep(track, { sourceStart: 0.95, sourceEnd: 1.05 }, 0, 60);
    expect(picked).toEqual([28, 29, 29, null, null, null]);
  });

  it("reads one frame ahead at most", async () => {
    const track = webcamTrack(30, 10);
    await lockstep(track, { sourceStart: 2, sourceEnd: 2.5 }, 0, 60);
    // 15 frames on screen (2.0 … 2.4667) plus the one it peeked to know 2.4667 was still frame 74,
    // plus the lead decoded before the segment.
    expect(track.stats.pulled).toBeLessThanOrEqual(15 + 1 + Math.ceil(WEBCAM_DECODE_LEAD * 30) + 1);
  });

  it("has no frame at all without a decode window (a segment wholly before the webcam)", async () => {
    const cursor = createWebcamCursor<Frame>(null, 0, 10);
    expect(await cursor.frameAt(1)).toBeNull();
    await cursor.close();
  });
});

describe("webcamDecodeWindow", () => {
  it("maps the clip's source range into webcam time, starting a little early", () => {
    expect(webcamDecodeWindow(2, 4, 500, 10)).toEqual({
      start: 1.5 - WEBCAM_DECODE_LEAD,
      end: 3.5,
    });
  });

  it("starts at 0 at the head of the file", () => {
    expect(webcamDecodeWindow(0, 1, 0, 10)).toEqual({ start: 0, end: 1 });
  });

  it("is null for a clip that ends before the webcam's first frame", () => {
    expect(webcamDecodeWindow(0, 0.4, 500, 10)).toBeNull();
  });

  it("is null for a clip that starts after the webcam's last frame", () => {
    expect(webcamDecodeWindow(12, 14, 0, 10)).toBeNull();
  });
});

describe("webcamLookupTime (E1)", () => {
  it("is the frame's own time inside the clip", () => {
    expect(webcamLookupTime(5.2, 5)).toBe(5.2);
  });

  it("is the clip's start for the frame that straddles it, however early that frame began", () => {
    expect(webcamLookupTime(4.6, 5)).toBe(5);
  });

  it("keeps the bubble on the first frame after a cut whose screen frame began long before it", async () => {
    // A still screen: the frame shown at the cut began 0.4 s earlier, beyond the decode lead.
    const track = webcamTrack(30, 10);
    const window = webcamDecodeWindow(5, 6, 0, track.duration)!;
    const cursor = createWebcamCursor<Frame>(track.frames(window.start, window.end), 0, 10);
    expect(await cursor.frameAt(4.6)).toBeNull(); // what looking up the raw timestamp gave
    expect((await cursor.frameAt(webcamLookupTime(4.6, 5)))?.index).toBe(150);
  });
});

describe("webcamFillTimes (E2: a still screen keeps the face moving)", () => {
  it("fills a 3 s gap between two screen frames at 30 fps (~89 frames)", () => {
    const times = webcamFillTimes(1, 4, 10, 30);
    expect(times).toHaveLength(89);
    expect(times[0]).toBeCloseTo(1 + 1 / 30);
    expect(times.at(-1)!).toBeLessThan(4 - 1 / 30 + 1e-6);
  });

  it("adds nothing between screen frames closer than one webcam frame", () => {
    expect(webcamFillTimes(1, 1 + 1 / 31, 10, 30)).toEqual([]);
    expect(webcamFillTimes(1, 1 + 1 / 30, 10, 30)).toEqual([]);
  });

  it("never fills across a cut: it stops one frame before the clip's end", () => {
    // The next screen frame is in the next clip (source 20 s); this clip ends at 10 s.
    const times = webcamFillTimes(9, 20, 10, 30);
    expect(times).toHaveLength(29);
    expect(times.every((t) => t < 10)).toBe(true);
    expect(webcamFillTimes(9.95, 20, 10, 30)).toEqual([]);
  });

  it("follows a lower frame-rate cap (24 fps tiers), so a fill never takes the next frame's slot", () => {
    expect(webcamFillTimes(0, 1, 10, 24)).toHaveLength(23);
  });
});

describe("fillWebcamGap", () => {
  /** A webcam at `fps`: the same object for the same frame, like the cursor's held frame. */
  const frames = (fps: number) => {
    const cache = new Map<number, { index: number }>();
    return (t: number) => {
      const index = Math.floor(t * fps + 1e-9);
      if (!cache.has(index)) cache.set(index, { index });
      return Promise.resolve(cache.get(index)!);
    };
  };

  it("emits one fill per new webcam frame over a still screen", async () => {
    const emitted: number[] = [];
    const source = frames(30);
    const state = await fillWebcamGap({
      state: { from: 0, face: await source(0) },
      nextFrame: 1,
      segmentEnd: 10,
      fps: 30,
      visible: () => true,
      frameAt: source,
      emit: async (t) => {
        emitted.push(t);
        return true;
      },
    });
    expect(emitted).toHaveLength(29);
    expect(state.face).toEqual({ index: 29 });
  });

  it("does not re-emit the frame already on screen (a slower webcam)", async () => {
    const emitted: number[] = [];
    const source = frames(15);
    await fillWebcamGap({
      state: { from: 0, face: await source(0) },
      nextFrame: 1,
      segmentEnd: 10,
      fps: 30,
      visible: () => true,
      frameAt: source,
      emit: async (t) => {
        emitted.push(t);
        return true;
      },
    });
    expect(emitted).toHaveLength(14);
  });

  it("emits nothing while the layer is hidden, except the one frame that removes the face", async () => {
    const emitted: Array<[number, unknown]> = [];
    await fillWebcamGap({
      state: { from: 0, face: { index: 0 } },
      nextFrame: 1,
      segmentEnd: 10,
      fps: 30,
      visible: (t) => t < 0.5,
      frameAt: frames(30),
      emit: async (t, face) => {
        emitted.push([t, face]);
        return true;
      },
    });
    const hidden = emitted.filter(([t]) => t >= 0.5);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]![1]).toBeNull();
  });

  it("emits nothing when no face was on screen and none is due (before the webcam starts)", async () => {
    const emit = vi.fn(async () => true);
    await fillWebcamGap({
      state: { from: 0, face: null },
      nextFrame: 1,
      segmentEnd: 10,
      fps: 30,
      visible: () => true,
      frameAt: async () => null,
      emit,
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it("resumes after the last time it considered, so the cursor never goes back", async () => {
    const asked: number[] = [];
    const opts = {
      segmentEnd: 10,
      fps: 30,
      visible: () => true,
      frameAt: async (t: number) => {
        asked.push(t);
        return { index: Math.floor(t * 30 + 1e-9) };
      },
      emit: async () => true,
    };
    const first = await fillWebcamGap({ ...opts, state: { from: 0, face: null }, nextFrame: 0.5 });
    // A screen frame was skipped (fps cap): the next gap starts at an older held frame.
    await fillWebcamGap({
      ...opts,
      state: { ...first, from: Math.max(first.from, 0.2) },
      nextFrame: 1,
    });
    expect(asked).toEqual([...asked].sort((a, b) => a - b));
  });
});

describe("fillWebcamGap durations (C1: the last fill reaches the gap's end)", () => {
  /** Runs a gap and returns what was emitted, as [time, face index or null, duration]. */
  async function emitted(opts: {
    nextFrame: number;
    segmentEnd: number;
    visible?: (t: number) => boolean;
    frameAt: (t: number) => { index: number } | null;
  }): Promise<Array<[number, number | null, number]>> {
    const cache = new Map<number, { index: number }>();
    const out: Array<[number, number | null, number]> = [];
    await fillWebcamGap({
      state: { from: 0, face: null },
      nextFrame: opts.nextFrame,
      segmentEnd: opts.segmentEnd,
      fps: 30,
      visible: opts.visible ?? (() => true),
      frameAt: async (t) => {
        const frame = opts.frameAt(t);
        if (!frame) return null;
        if (!cache.has(frame.index)) cache.set(frame.index, frame);
        return cache.get(frame.index)!;
      },
      emit: async (t, face, duration) => {
        out.push([t, face?.index ?? null, duration]);
        return true;
      },
    });
    return out;
  }

  /**
   * No emitted frame ends before the next one starts (the muxer trims each to the next
   * timestamp, so only the LAST declared duration survives), and the last reaches `end`.
   */
  const expectContiguous = (frames: Array<[number, number | null, number]>, end: number) => {
    expect(frames.length).toBeGreaterThan(0);
    for (let i = 0; i + 1 < frames.length; i++) {
      expect(frames[i]![0] + frames[i]![2]).toBeGreaterThanOrEqual(frames[i + 1]![0] - 1e-9);
    }
    const last = frames.at(-1)!;
    expect(last[0] + last[2]).toBeCloseTo(end);
  };

  const webcam30 = (t: number) => ({ index: Math.floor(t * 30 + 1e-9) });

  it("webcam hidden mid final gap: the frame that removes the face lasts to the clip's end", async () => {
    // A 10 s still screen, the last of its clip; the webcam is hidden from 5 s on.
    const frames = await emitted({
      nextFrame: 10,
      segmentEnd: 10,
      visible: (t) => t < 5 - 1e-9,
      frameAt: webcam30,
    });
    expect(frames.at(-1)![1]).toBeNull();
    expect(frames.at(-1)![0]).toBeCloseTo(5);
    expectContiguous(frames, 10);
  });

  it("webcam ending mid final gap: its last frame's removal lasts to the clip's end", async () => {
    const frames = await emitted({
      nextFrame: 10,
      segmentEnd: 10,
      frameAt: (t) => (t < 3 ? webcam30(t) : null),
    });
    expect(frames.at(-1)![1]).toBeNull();
    expectContiguous(frames, 10);
  });

  it("webcam failing mid gap (no frame from then on): the last fill reaches the next screen frame", async () => {
    let failed = false;
    const frames = await emitted({
      nextFrame: 4,
      segmentEnd: 10,
      frameAt: (t) => {
        if (t >= 2) failed = true;
        return failed ? null : webcam30(t);
      },
    });
    expectContiguous(frames, 4);
  });

  it("a gap that ends at a cut reaches the clip's end, not the next clip's frame", async () => {
    const frames = await emitted({ nextFrame: 20, segmentEnd: 10, frameAt: webcam30 });
    expectContiguous(frames, 10);
  });
});
