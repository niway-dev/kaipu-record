import type { CursorTrack } from "@shared/cursor-track";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { withJoinedZooms } from "./initial-zooms";
import type { VideoScene } from "./scene";
import { joinRecording, type JoinedRecordingInput } from "./source-axis";
import { withJoinedWebcam } from "./scene";

/**
 * The scene after joining a recording (ADR 0058), as ONE value so the caller commits it as one
 * undo step: the clip and the new source (`joinRecording`), then the recording's own auto zooms
 * (`withJoinedZooms`, from its cursor `track`) and its webcam layer and hidden gaps
 * (`withJoinedWebcam`, from its `webcam` meta). Both follow the offset `joinRecording` gave the
 * new source. Pure: the media (track, meta) is loaded by the caller BEFORE it composes.
 */
export function composeJoin(
  scene: VideoScene,
  primaryDuration: number,
  input: JoinedRecordingInput,
  t: number,
  track: CursorTrack | null,
  webcam: WebcamTrackMeta | null,
): VideoScene {
  const { scene: joined, source } = joinRecording(scene, primaryDuration, input, t);
  return withJoinedWebcam(withJoinedZooms(joined, source, track), webcam, source);
}
