/**
 * Keeping the preview's second <video> (the webcam file) in step with the main one
 * (ADR 0038 § consequences). Pure: the WebcamLayer reads the elements and applies the
 * verdict, so the rule is testable without media.
 *
 * Offset semantics (ADR 0037): `startOffsetMs = webcamT0 − screenT0`. A webcam that started
 * 500 ms after the screen shows its first frame at screen time 0.5 s, so for screen source
 * time `t` the webcam time is `t − startOffsetMs / 1000`.
 */

import { recordingAt, type SourceAxis } from "../source-axis";

/** One recording's webcam file: null `src` = it was recorded without one. */
export interface WebcamFile {
  src: string | null;
  startOffsetMs: number;
}

/**
 * The webcam files of every recording in the scene, by `SceneSource.id` (null = the opened
 * recording), and the axis that says which recording holds an axis second (ADR 0058).
 */
export interface WebcamRecordings {
  axis: SourceAxis;
  files: ReadonlyMap<string | null, WebcamFile>;
}

/**
 * The webcam file to show at axis second `t`, with its own offset and the LOCAL second the
 * offset applies to (`webcamTimeFor(localTime, startOffsetMs)`): a webcam's clock starts with
 * its own recording, so the axis offset is taken off first. Without `recordings` (one
 * recording) the opened file serves every second. A second no range holds (a legacy clip)
 * is the opened recording's.
 */
export function webcamFileAt(
  recordings: WebcamRecordings | undefined,
  opened: WebcamFile,
  t: number,
): WebcamFile & { localTime: number } {
  if (!recordings) return { ...opened, localTime: t };
  const found = recordingAt(recordings.axis, t);
  if (!found) return { ...opened, localTime: t };
  const file = recordings.files.get(found.recording.sourceId);
  return {
    src: file?.src ?? null,
    startOffsetMs: file?.startOffsetMs ?? 0,
    localTime: found.localTime,
  };
}

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
 *
 * `lastSeekSeconds` is wall time, but the lead is added to a MEDIA time: while the seek ran
 * the main video advanced `lastSeekSeconds × rate`, so the lead is scaled by the main
 * element's `playbackRate` (1 when omitted). The result is in media seconds.
 */
export function webcamSeekLead(mainPlaying: boolean, lastSeekSeconds: number, rate = 1): number {
  const lead = lastSeekSeconds * rate;
  if (!mainPlaying || !(lead > WEBCAM_DRIFT_SECONDS)) return 0;
  return Math.min(lead, WEBCAM_MAX_SEEK_LEAD_SECONDS);
}
