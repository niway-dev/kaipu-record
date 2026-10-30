import { describe, expect, it } from "vitest";
import { createWebcamCursor, webcamDecodeWindow, WEBCAM_DECODE_LEAD } from "./webcam-lockstep";

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
