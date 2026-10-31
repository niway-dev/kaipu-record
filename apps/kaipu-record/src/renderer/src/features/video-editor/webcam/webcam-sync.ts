/**
 * Keeping the preview's second <video> (the webcam file) in step with the main one
 * (ADR 0038 § consequences). Pure: the WebcamLayer reads the elements and applies the
 * verdict, so the rule is testable without media.
 *
 * Offset semantics (ADR 0037): `startOffsetMs = webcamT0 − screenT0`. A webcam that started
 * 500 ms after the screen shows its first frame at screen time 0.5 s, so for screen source
 * time `t` the webcam time is `t − startOffsetMs / 1000`.
 */

/** Drift past which the webcam element is re-seeked: a little over two webcam frames. */
export const WEBCAM_DRIFT_SECONDS = 0.08;

/** The webcam file's time for screen SOURCE seconds `t`. */
export function webcamTimeFor(t: number, startOffsetMs: number): number {
  return t - startOffsetMs / 1000;
}

/**
 * Whether the webcam file has a frame at `webcamTime`: hidden before its first frame and
 * after its last. An unknown duration (NaN, 0: metadata not loaded) has nothing to show; an
 * infinite one (a stream without a known end) has no last frame.
 */
export function webcamHasFrameAt(webcamTime: number, duration: number): boolean {
  if (!Number.isFinite(webcamTime) || webcamTime < 0) return false;
  if (Number.isNaN(duration) || duration <= 0) return false;
  return webcamTime < duration;
}

/**
 * The time to seek the webcam element to, or null when it is close enough. Seeks when the
 * element strays more than {@link WEBCAM_DRIFT_SECONDS} from the target; the target is held
 * inside [0, duration] so a seek never asks for a time the file does not have.
 */
export function webcamResyncTarget(
  current: number,
  target: number,
  duration: number,
): number | null {
  const bounded = Number.isFinite(duration) && duration > 0 ? Math.min(target, duration) : target;
  const wanted = Math.max(0, bounded);
  return Math.abs(current - wanted) > WEBCAM_DRIFT_SECONDS ? wanted : null;
}
