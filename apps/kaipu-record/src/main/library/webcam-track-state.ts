/**
 * The one rule for "this item has a webcam track" (ADR 0032), so the library's answers agree:
 * `describe()` takes `meta` (what the editor and export can use), `probeWebcam` the `state`
 * (what remove-local-copy protects, and what the editor reports as missing). Pure; the
 * callers read the file's existence and the sidecar.
 *
 * - "present": `.kaipu/<id>.webcam.mp4` exists. `meta` is the sanitized sidecar field, or null
 *   when it has none or a malformed one (a recovered take gets no field): the file still
 *   exists, may hold the only copy of the face, and must not be removed with the local copy.
 * - "missing": the sidecar records a usable webcam, but the file is gone.
 * - "none": no file and no usable field.
 */
import { sanitizeWebcamTrackMeta, type WebcamTrackMeta } from "@shared/webcam-track";

export type WebcamState = "present" | "missing" | "none";

export function webcamTrackState(
  fileExists: boolean,
  sidecarWebcam: unknown,
): { state: WebcamState; meta: WebcamTrackMeta | null } {
  const meta = sanitizeWebcamTrackMeta(sidecarWebcam);
  if (fileExists) return { state: "present", meta };
  return { state: meta ? "missing" : "none", meta: null };
}
