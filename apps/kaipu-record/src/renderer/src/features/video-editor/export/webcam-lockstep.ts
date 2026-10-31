/**
 * Which webcam frame goes with each exported screen frame (ADR 0038, spec failure 8). The
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

/**
 * Source times at which to add an output frame between two screen frames, so the face keeps
 * moving over a still screen (screen capture is change-driven: one frame can stay on screen
 * for seconds). Every `1/fps` after `from` (the held frame's time, or the last fill), and
 * only while a whole fill period is left before the next screen frame and before the clip's
 * end, so a fill never shares a frame-rate-cap slot with the next frame and never crosses a
 * cut. `fps` is the webcam's rate, or the preset's cap when lower.
 */
export function webcamFillTimes(
  from: number,
  nextFrame: number,
  segmentEnd: number,
  fps: number,
): number[] {
  if (!(fps > 0)) return [];
  const last = Math.min(nextFrame, segmentEnd) - 1 / fps + EPS;
  const times: number[] = [];
  for (let k = 1; from + k / fps <= last; k++) times.push(from + k / fps);
  return times;
}

/** Where the fills of a clip stand: the last time considered and the face last drawn. */
export interface WebcamFillState<T> {
  from: number;
  face: T | null;
}

/**
 * Fills one gap (see {@link webcamFillTimes}): for each fill time, the webcam frame due
 * then (none while the layer is hidden), emitted only when it changes what is on screen —
 * a new webcam frame, or the face disappearing. `emit` re-composes the held screen frame
 * with it and returns false when it could not add the frame (the timestamp did not
 * advance, or the fps cap took the slot). Returns the new state.
 *
 * Each fill is declared to last until the gap's end (the next screen frame, or the clip's
 * end when that comes first). The muxer replaces every duration but the last with the gap
 * to the next timestamp, so only the final frame's matters, and it must reach the end: a
 * fill that removes the face (hidden, or the webcam ended or failed) can be the last frame
 * of the clip, and a 1/fps duration there would cut the video track short.
 */
export async function fillWebcamGap<T>(opts: {
  state: WebcamFillState<T>;
  nextFrame: number;
  segmentEnd: number;
  fps: number;
  visible(sourceTime: number): boolean;
  frameAt(sourceTime: number): Promise<T | null>;
  emit(sourceTime: number, face: T | null, duration: number): Promise<boolean>;
}): Promise<WebcamFillState<T>> {
  let { from, face } = opts.state;
  const gapEnd = Math.min(opts.nextFrame, opts.segmentEnd);
  for (const t of webcamFillTimes(from, opts.nextFrame, opts.segmentEnd, opts.fps)) {
    from = t;
    const due = opts.visible(t) ? await opts.frameAt(t) : null;
    if (due === face) continue;
    if (await opts.emit(t, due, gapEnd - t)) face = due;
  }
  return { from, face };
}
