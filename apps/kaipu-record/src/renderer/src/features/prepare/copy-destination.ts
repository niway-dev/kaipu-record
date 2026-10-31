import type { LibraryVideo } from "@renderer/features/library/types";
import type { ExportPresetId } from "@renderer/features/video-editor/export/export-presets";
import { WHOLE_RECORDING_FINGERPRINT } from "@renderer/features/video-editor/export/export-reuse";
import { type DestinationId, destinationOfPreset } from "./destinations";

/**
 * The preset of a copy made for a destination (Prepare, Share: the whole recording, no
 * edits); null for an editor export, a GIF, an original or a file older than fingerprints.
 *
 * The sidecar records the content fingerprint plus the preset's encode revision
 * (`encodeFingerprint`: "whole#2560x1440-v1"), so only the part before "#" is compared.
 */
export function copyPresetOf(video: Pick<LibraryVideo, "kind" | "export">): ExportPresetId | null {
  if (video.kind !== "recording" || !video.export?.fingerprint) return null;
  const content = video.export.fingerprint.split("#", 1)[0];
  return content === WHOLE_RECORDING_FINGERPRINT ? video.export.preset : null;
}

/**
 * Where a copy is going: the export job's destination when the runner still knows it (a
 * copy that just finished), else the destination its sidecar stored, else the one its preset
 * belongs to (copies made before the destination was stored; Balanced reads as chat).
 */
export function copyDestinationOf(
  video: Pick<LibraryVideo, "kind" | "export">,
  jobDestination?: DestinationId,
): DestinationId | null {
  if (jobDestination) return jobDestination;
  const preset = copyPresetOf(video);
  if (!preset) return null;
  return video.export?.destination ?? destinationOfPreset(preset);
}
