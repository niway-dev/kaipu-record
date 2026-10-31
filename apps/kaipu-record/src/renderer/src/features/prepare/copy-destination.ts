import type { LibraryVideo } from "@renderer/features/library/types";
import type { ExportPresetId } from "@renderer/features/video-editor/export/export-presets";
import { isWholeFingerprint } from "@renderer/features/video-editor/export/export-reuse";
import { type DestinationId, destinationOfPreset } from "./destinations";

/**
 * The preset of a copy made for a destination (Prepare, Share: the whole recording, no
 * edits); null for an editor export, a GIF, an original or a file older than fingerprints.
 *
 * The sidecar records the content fingerprint plus the preset's encode revision
 * (`encodeFingerprint`: "whole#2560x1440-v1"), so only the part before "#" is compared. A take
 * with a webcam reads "whole:<face hash>" there (NIW2-576); it is still the whole recording.
 */
export function copyPresetOf(video: Pick<LibraryVideo, "kind" | "export">): ExportPresetId | null {
  if (video.kind !== "recording" || !video.export?.fingerprint) return null;
  const content = video.export.fingerprint.split("#", 1)[0];
  return isWholeFingerprint(content) ? video.export.preset : null;
}

/**
 * Where a copy is going: the export job's destination when the runner still knows it (a
 * copy that just finished), otherwise read back from the file's sidecar.
 */
export function copyDestinationOf(
  video: Pick<LibraryVideo, "kind" | "export">,
  jobDestination?: DestinationId,
): DestinationId | null {
  if (jobDestination) return jobDestination;
  const preset = copyPresetOf(video);
  return preset ? destinationOfPreset(preset) : null;
}
