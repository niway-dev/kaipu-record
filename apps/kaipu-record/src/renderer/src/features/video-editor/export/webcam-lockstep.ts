/**
 * Which webcam frame goes with each exported screen frame (ADR 0033, spec failure 8). The
 * MP4 worker decodes the webcam file sequentially beside the screen and asks, for every
 * screen frame it keeps, for the webcam frame on screen at that SOURCE time: the last one
 * whose `timestamp + offset ≤ sourceTs`, held until the next one is due (a 30 fps webcam
 * against 60 fps screen frames shows each webcam frame twice). It never shows a frame
 * before its time and reads at most one frame ahead (to know the held one is still due).
 *
 * Cuts are handled by the caller: each clip segment gets its own cursor over its own
 * decode window (`webcamDecodeWindow`), so the next clip resumes at its own source time.
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free. The iterator is
 * mediabunny's `CanvasSink.canvases()` in the worker and a synthetic one in the tests.
 */
import { webcamHasFrameAt, webcamTimeFor } from "../webcam/webcam-sync";

/**
 * Seconds of webcam decoded before a clip's first frame: the screen's first frame of a clip
 * straddles its start (rebase-timestamp.ts), and must find its webcam frame too.
 */
export const WEBCAM_DECODE_LEAD = 0.1;

/** Float slack when comparing a frame's timestamp to the time it is due. */
const EPS = 1e-6;

/**
 * The webcam-file window to decode for a clip over source [sourceStart, sourceEnd), or null
 * when the clip ends before the webcam's first frame or starts after its last.
 */
export function webcamDecodeWindow(
  sourceStart: number,
  sourceEnd: number,
  startOffsetMs: number,
  duration: number,
): { start: number; end: number } | null {
  const start = webcamTimeFor(sourceStart, startOffsetMs);
  const end = webcamTimeFor(sourceEnd, startOffsetMs);
  if (end <= 0 || !(duration > 0) || start >= duration) return null;
  return { start: Math.max(0, start - WEBCAM_DECODE_LEAD), end };
}

/**
 * The screen SOURCE time a clip frame stands for when picking its webcam frame: its own
 * timestamp, or the clip's start for the frame that straddles it. mediabunny yields the
 * frame spanning a clip's start first, and on a still screen it can begin seconds before
 * the cut: looked up at its own time it would show cut footage's face, or none at all.
 */
export function webcamLookupTime(frameTimestamp: number, sourceStart: number): number {
  return Math.max(frameTimestamp, sourceStart);
}

export interface WebcamCursor<T> {
  /**
   * The webcam frame on screen at screen SOURCE time `sourceTime`, or null before the
   * webcam's first frame and after its last. Calls must not go back in time.
   */
  frameAt(sourceTime: number): Promise<T | null>;
  /** Stops the underlying decode (a segment that ended early). */
  close(): Promise<void>;
}

/**
 * A lockstep cursor over `frames` (ascending timestamps, webcam time), or a cursor that
 * never has a frame when `frames` is null (no decode window for this clip).
 */
export function createWebcamCursor<T extends { timestamp: number }>(
  frames: AsyncIterator<T> | null,
  startOffsetMs: number,
  duration: number,
): WebcamCursor<T> {
  let current: T | null = null;
  let next: T | null = null;
  let primed = false;
  let done = frames === null;

  const pull = async (): Promise<T | null> => {
    if (done || !frames) return null;
    const result = await frames.next();
    if (result.done) {
      done = true;
      return null;
    }
    return result.value;
  };

  return {
    async frameAt(sourceTime) {
      const webcamTime = webcamTimeFor(sourceTime, startOffsetMs);
      if (!webcamHasFrameAt(webcamTime, duration)) return null;
      if (!primed) {
        primed = true;
        next = await pull();
      }
      while (next && next.timestamp <= webcamTime + EPS) {
        current = next;
        next = await pull();
      }
      return current && current.timestamp <= webcamTime + EPS ? current : null;
    },
    async close() {
      done = true;
      await frames?.return?.();
    },
  };
}
