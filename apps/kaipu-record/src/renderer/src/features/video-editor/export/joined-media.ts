/**
 * Joined recordings in the MP4 export's media readers (ADR 0058). The plan, the loop in
 * export-clip-frames.ts, the redactions, camera, cursor and overlays all speak AXIS seconds;
 * only a decoder wants its own file's local seconds. This module is the one place that
 * translates, in both directions: the decode range goes axis -> local (`clipSource`), and what
 * comes back (screen frames, webcam lookups) goes local -> axis (`shiftFrames`,
 * `offsetWebcamCursor`). The opened recording has offset 0, so its path is untouched.
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free; no mediabunny import.
 */
import type { ClipFrame } from "./export-clip-frames";
import type { RenderClipSegment } from "./export-plan";
import type { WebcamCursor } from "./webcam-lockstep";

/** A joined recording as the clip readers need it: its id and where it starts on the axis. */
export interface JoinedClipRef {
  sourceId: string;
  offset: number;
}

/** Which reader a clip uses, and the range in that reader's own seconds. */
export interface ClipSource {
  /** `SceneSource.id`, or null for the opened recording. */
  key: string | null;
  localStart: number;
  localEnd: number;
  /** Axis second of the file's second 0 (0 for the opened recording). */
  offset: number;
}

export function clipSource(
  segment: Pick<RenderClipSegment, "sourceId" | "sourceStart" | "sourceEnd">,
  joined: readonly JoinedClipRef[],
): ClipSource {
  if (segment.sourceId === null) {
    return { key: null, localStart: segment.sourceStart, localEnd: segment.sourceEnd, offset: 0 };
  }
  const entry = joined.find((j) => j.sourceId === segment.sourceId);
  if (!entry) throw new Error(`export: no file for joined recording ${segment.sourceId}`);
  return {
    key: entry.sourceId,
    localStart: segment.sourceStart - entry.offset,
    localEnd: segment.sourceEnd - entry.offset,
    offset: entry.offset,
  };
}

/** Frames with their timestamps moved by `offset` seconds; canvas and duration are kept. */
export async function* shiftFrames<F extends ClipFrame>(
  frames: AsyncIterable<F>,
  offset: number,
): AsyncGenerator<F> {
  for await (const frame of frames) yield { ...frame, timestamp: frame.timestamp + offset };
}

/** A cursor asked in axis seconds, reading a file whose second 0 is axis `offset`. */
export function offsetWebcamCursor<T>(cursor: WebcamCursor<T>, offset: number): WebcamCursor<T> {
  return {
    frameAt: (axisTime) => cursor.frameAt(axisTime - offset),
    close: () => cursor.close(),
  };
}

/** The clip's screen frames, decoded from its own recording and stamped in axis seconds. */
export function clipFramesOf<F extends ClipFrame>(
  src: ClipSource,
  readers: ReadonlyMap<string | null, { canvases(start: number, end: number): AsyncIterable<F> }>,
): AsyncIterable<F> {
  const reader = readers.get(src.key);
  if (!reader) throw new Error(`export: no reader for recording ${src.key ?? "(opened)"}`);
  const frames = reader.canvases(src.localStart, src.localEnd);
  return src.offset === 0 ? frames : shiftFrames(frames, src.offset);
}

/** The clip's webcam cursor in axis seconds, or null when its recording has no webcam. */
export function clipWebcamCursorOf<T>(
  src: ClipSource,
  webcams: ReadonlyMap<string | null, { cursorFor(start: number, end: number): WebcamCursor<T> }>,
): WebcamCursor<T> | null {
  const source = webcams.get(src.key);
  if (!source) return null;
  const cursor = source.cursorFor(src.localStart, src.localEnd);
  return src.offset === 0 ? cursor : offsetWebcamCursor(cursor, src.offset);
}
