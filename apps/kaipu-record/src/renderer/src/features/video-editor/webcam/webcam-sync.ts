/**
 * Keeping the preview's second <video> (the webcam file) in step with the main one
 * (ADR 0033 § consequences). Pure: the WebcamLayer reads the elements and applies the
 * verdict, so the rule is testable without media.
 *
 * Offset semantics (ADR 0032): `startOffsetMs = webcamT0 − screenT0`. A webcam that started
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

/** The longest lead a seek is given; a slower seek than this is not worth predicting. */
export const WEBCAM_MAX_SEEK_LEAD_SECONDS = 1;

/**
 * How far past the target to seek the webcam: while the main video plays, a seek that took
 * `lastSeekSeconds` (a long keyframe interval decodes from far back) lands that much behind
 * the screen, and the catch-up seek would lag the same way. Aiming ahead by the last
 * measured seek lands it on time. Nothing while paused, and nothing for seeks short enough
 * that the drift rule already absorbs them.
 */
export function webcamSeekLead(mainPlaying: boolean, lastSeekSeconds: number): number {
  if (!mainPlaying || !(lastSeekSeconds > WEBCAM_DRIFT_SECONDS)) return 0;
  return Math.min(lastSeekSeconds, WEBCAM_MAX_SEEK_LEAD_SECONDS);
}
