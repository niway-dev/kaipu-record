/**
 * The webcam file as a second decoder in the export workers (ADR 0033): opened only when the
 * plan has a webcam layer and the renderer sent the file, so a recording without a webcam
 * pays for nothing (no second Input). Both workers read webcam frames through it; which
 * frame goes with which screen frame is `webcam-lockstep.ts`.
 *
 * Worker-only (mediabunny); DOM-free.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { WrappedCanvas } from "mediabunny";
import type { WebcamScene } from "../webcam/webcam-model";
import { webcamHasFrameAt, webcamTimeFor } from "../webcam/webcam-sync";
import type { WebcamImage } from "./compose-webcam";
import type { WebcamTrackMessage } from "./export-messages";
import { createWebcamCursor, webcamDecodeWindow, type WebcamCursor } from "./webcam-lockstep";

/**
 * Canvases in the webcam sink's ring buffer. The lockstep cursor holds two decoded frames
 * (the one on screen and the one it peeked at); the third slot is headroom.
 */
export const WEBCAM_CANVAS_POOL_SIZE = 3;

export interface WebcamSource {
  /** Duration of the webcam file, in its own seconds (the end of its last frame). */
  duration: number;
  /** MP4: a lockstep cursor over one clip segment's source range [sourceStart, sourceEnd). */
  cursorFor(sourceStart: number, sourceEnd: number): WebcamCursor<WrappedCanvas>;
  /**
   * GIF: the webcam frame on screen at each SOURCE time (ascending within one call), null
   * before the webcam's first frame and after its last.
   */
  framesAt(sourceTimes: number[]): AsyncGenerator<WebcamImage | null, void, unknown>;
  dispose(): void;
}

/** A decoded webcam canvas as the composer takes it. */
export function webcamImageOf(wrapped: WrappedCanvas | null): WebcamImage | null {
  if (!wrapped) return null;
  return { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height };
}

/**
 * Opens the webcam file, or returns null (without opening anything) when there is no layer
 * or no file. A file without a video track is treated as no file. Native size: the file is
 * already ≤ 1080 lines (720 without framing), and framing zooms into it.
 */
export async function openWebcamSource(
  webcam: WebcamTrackMessage | null,
  scene: WebcamScene | null,
): Promise<WebcamSource | null> {
  if (!webcam || !scene) return null;
  const input = new Input({ source: new BlobSource(webcam.blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) {
      input.dispose();
      return null;
    }
    const duration = await track.computeDuration();
    const sink = new CanvasSink(track, { poolSize: WEBCAM_CANVAS_POOL_SIZE });
    const { startOffsetMs } = webcam;
    return {
      duration,
      cursorFor(sourceStart, sourceEnd) {
        const window = webcamDecodeWindow(sourceStart, sourceEnd, startOffsetMs, duration);
        return createWebcamCursor(
          window ? sink.canvases(window.start, window.end) : null,
          startOffsetMs,
          duration,
        );
      },
      async *framesAt(sourceTimes) {
        const times = sourceTimes.map((t) => webcamTimeFor(t, startOffsetMs));
        let i = 0;
        for await (const wrapped of sink.canvasesAtTimestamps(times.map((t) => Math.max(0, t)))) {
          const shown = webcamHasFrameAt(times[i++]!, duration);
          yield shown ? webcamImageOf(wrapped) : null;
        }
      },
      dispose: () => input.dispose(),
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}
