/**
 * The MP4 export's video pass over ONE clip segment (export-worker.ts), lifted out of the
 * worker so it runs under test with a fake sink, cursor and composer (review E10):
 *
 *   for each decoded screen frame: fill the gap the previous frame left (webcam fills, E2)
 *   → rebase to output time → fps cap → the webcam frame due → compose → emit
 *   then fill until the clip's end.
 *
 * Everything that needs WebCodecs stays in the worker: it hands in the sink's frames, the
 * webcam cursor, the composer and `emit` (poster, encoder, progress), and threads the
 * returned `prevOutTs` into the next segment.
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free; no mediabunny import.
 */
import { webcamAt, type WebcamScene } from "../webcam/webcam-model";
import type { OutputComposer } from "./compose-output-frame";
import type { WebcamImage } from "./compose-webcam";
import type { RenderClipSegment } from "./export-plan";
import type { FrameRateCap } from "./frame-rate-cap";
import { rebaseVideoTimestamp } from "./rebase-timestamp";
import {
  fillWebcamGap,
  type WebcamCursor,
  type WebcamFillState,
  webcamLookupTime,
} from "./webcam-lockstep";

/** A decoded screen frame, as mediabunny's `CanvasSink` yields it. */
export interface ClipFrame {
  canvas: CanvasImageSource;
  timestamp: number;
  duration: number;
}

export interface ClipFramesOptions<F extends ClipFrame, W> {
  segment: RenderClipSegment;
  /** The screen frames over the segment's source range, ascending. */
  frames: AsyncIterable<F>;
  /** The webcam frames of this clip (null: no webcam). The caller closes it. */
  webcamCursor: WebcamCursor<W> | null;
  /** The plan's webcam layer (null: none). */
  layer: WebcamScene | null;
  webcamImageOf(face: W | null): WebcamImage | null;
  /** Rate of the webcam fills over a still screen (the webcam's, or the preset's cap). */
  fillFps: number;
  cap: FrameRateCap;
  /** One cap slot (0 without a cap): the shortest duration a kept frame is given. */
  minFrameGap: number;
  /** The last output timestamp of the previous segments, threaded across cuts. */
  prevOutTs: number | null;
  compose: Pick<OutputComposer, "clip">;
  /** Hand the composed canvas to the encoder at `outTs` for `duration` seconds. */
  emit(outTs: number, duration: number): Promise<void>;
}

/** Encodes one clip segment's frames; returns the new `prevOutTs`. */
export async function exportClipFrames<F extends ClipFrame, W>(
  opts: ClipFramesOptions<F, W>,
): Promise<number | null> {
  const { segment, webcamCursor, layer, cap, compose } = opts;
  let prevOutTs = opts.prevOutTs;
  // The latest screen frame decoded (kept or not): what the source shows until the next
  // one, so the fills re-compose it. Its canvas stays intact while the next is decoded
  // (the sink's pool has two slots, see canvas-sink-options.ts).
  let held: F | null = null;
  let fills: WebcamFillState<W> = { from: segment.sourceStart, face: null };
  const fillUntil = async (nextFrame: number): Promise<void> => {
    if (!held || !webcamCursor || !layer) return;
    const frame = held;
    fills = await fillWebcamGap({
      state: fills,
      nextFrame,
      segmentEnd: segment.sourceEnd,
      fps: opts.fillFps,
      visible: (t) => webcamAt({ webcam: layer }, t) !== null,
      frameAt: (t) => webcamCursor.frameAt(t),
      // `duration` reaches the gap's end: the last fill of a clip must (see fillWebcamGap).
      emit: async (t, face, duration) => {
        const outTs = segment.timelineStart + (t - segment.sourceStart);
        if (prevOutTs !== null && outTs <= prevOutTs) return false;
        if (!cap.keep(outTs)) return false;
        const image = opts.webcamImageOf(face);
        // The held frame's own source span decides its redactions; the zoom crop follows
        // the camera at the fill's time, like the face's shrink (E9).
        compose.clip(
          frame.canvas,
          frame.timestamp,
          frame.duration,
          outTs,
          image ? { image, sourceTs: t } : null,
          t,
        );
        await opts.emit(outTs, duration);
        prevOutTs = outTs;
        return true;
      },
    });
  };

  for await (const wrapped of opts.frames) {
    // One time for the webcam frame, its layout and the camera scale (E1).
    const webcamTime = webcamLookupTime(wrapped.timestamp, segment.sourceStart);
    // Keep the face moving over the gap the previous screen frame left (E2).
    await fillUntil(webcamTime);
    held = wrapped;
    fills = { ...fills, from: Math.max(fills.from, webcamTime) };
    // Remap the source timestamp to the output (collapsed) timeline, clamped to never go
    // negative or regress — see rebase-timestamp.ts for why the straddling first frame
    // needs this.
    const outTs = rebaseVideoTimestamp(
      segment.timelineStart,
      segment.sourceStart,
      wrapped.timestamp,
      prevOutTs,
    );
    if (outTs === null) continue; // straddle/duplicate frame — skip, don't advance prevOutTs
    // fps cap: drop a frame whose slot is taken. The kept frame's sample lasts until the
    // next kept one (the muxer derives durations from timestamp deltas), so timestamps stay
    // monotonic and the timeline length is unchanged.
    if (!cap.keep(outTs)) continue;
    const face = webcamCursor ? await webcamCursor.frameAt(webcamTime) : null;
    const webcamImage = opts.webcamImageOf(face);
    compose.clip(
      wrapped.canvas,
      wrapped.timestamp,
      wrapped.duration,
      outTs,
      webcamImage ? { image: webcamImage, sourceTs: webcamTime } : null,
    );
    // What is on screen now, for the next gap's fills.
    fills = {
      ...fills,
      face: layer && webcamAt({ webcam: layer }, webcamTime) ? face : null,
    };
    // The frame's own decoded duration (at least one cap slot); the muxer stretches it to
    // the next kept frame anyway.
    await opts.emit(outTs, Math.max(wrapped.duration, opts.minFrameGap));
    prevOutTs = outTs;
  }
  // The last screen frame of the clip stays up until the clip ends: fill that too.
  await fillUntil(segment.sourceEnd);
  return prevOutTs;
}
