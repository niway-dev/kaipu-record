/**
 * The webcam file for an export (ADR 0033), fetched like the source: only when the plan has
 * a webcam layer and the recording has a webcam track, so a recording without one makes no
 * request and its worker opens no second decoder. A missing file (404: deleted, or never
 * finalized) exports without the layer rather than failing the whole export.
 */
import type { WebcamTrackMeta } from "@shared/webcam-track";
import type { WebcamScene } from "../webcam/webcam-model";
import type { WebcamTrackMessage } from "./export-messages";

/** What the export needs from the recording's webcam track (the sidecar's `webcam`). */
export type ExportWebcamTrack = Pick<WebcamTrackMeta, "startOffsetMs">;

export async function fetchWebcamTrack(
  sourceId: string,
  layer: WebcamScene | null,
  track: ExportWebcamTrack | null | undefined,
): Promise<WebcamTrackMessage | null> {
  if (!layer || !track) return null;
  const response = await fetch(`kaipu-media://webcam/${sourceId}`);
  if (!response.ok) return null;
  return { blob: await response.blob(), startOffsetMs: track.startOffsetMs };
}
