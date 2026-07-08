import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { RecordingBackfillMeta } from "@shared/types";
import { generateThumbnail } from "@renderer/lib/generate-thumbnail";

/**
 * Derives duration + poster for a vault recording whose sidecar is missing — a
 * hand-imported clip, or one whose `finalize` was interrupted. Runs in the
 * renderer because both steps need a video decoder (WebCodecs), which the main
 * process lacks: duration is demuxed via mediabunny, the poster decoded via the
 * shared {@link generateThumbnail} primitive.
 *
 * Returns null (never throws) when the file can't be read. A zero duration is
 * treated as "unreadable" and NOT persisted — caching a bad 0 would permanently
 * disable the editor for a transient error; leaving it an orphan lets a later
 * scan retry. Sub-second clips (floor → 0) share this fate, matching how the
 * recorder itself floors duration.
 */
export async function healOrphanMetadata(id: string): Promise<RecordingBackfillMeta | null> {
  try {
    const blob = await (await fetch(`kaipu-media://recording/${id}`)).blob();
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const durationSeconds = Math.floor(await input.computeDuration());
    if (durationSeconds <= 0) return null;

    const thumbnail = await generateThumbnail(blob, Math.min(1, durationSeconds / 2));
    return { durationSeconds, thumbnail };
  } catch {
    return null;
  }
}
