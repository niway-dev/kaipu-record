/**
 * Auto-zoom detection across the recordings of one scene (ADR 0058). A scene has one source
 * axis; each recording owns a range of it, and its cursor track is in its OWN seconds. So
 * detection runs once per recording, on its own track and duration, and every result is shifted
 * by the recording's offset and kept inside its range. Pure; the detector itself stays in
 * detect-zoom-segments.ts (scene.ts must not import it, see `initialScene`).
 */
import type { CursorTrack } from "@shared/cursor-track";
import { detectZoomSegments, replaceAutoSegments } from "./detect-zoom-segments";
import type { ZoomSegment } from "./zoom-model";

export interface RecordingZoomInput {
  /** Start of the recording's range on the source axis (0 for the opened recording). */
  offset: number;
  /** Length of the recording in seconds. */
  duration: number;
  /** Its cursor track, in its own seconds; null when it has none (nothing is detected). */
  track: CursorTrack | null;
}

/**
 * The auto zoom segments of every recording, on the source axis, sorted by start. One entry with
 * offset 0 gives exactly what `detectZoomSegments` returns. A shifted segment gets the id the
 * detector would mint from its axis start (`auto-<ms>`), so ids stay unique across recordings.
 */
export function detectRecordingZooms(
  recordings: readonly RecordingZoomInput[],
  sensitivity: number,
): ZoomSegment[] {
  const out: ZoomSegment[] = [];
  for (const { offset, duration, track } of recordings) {
    if (!track) continue;
    for (const segment of detectZoomSegments(track, duration, sensitivity)) {
      if (offset === 0) {
        out.push(segment);
        continue;
      }
      const start = segment.start + offset;
      out.push({
        ...segment,
        id: `auto-${Math.round(start * 1000)}`,
        start,
        end: Math.min(segment.end + offset, offset + duration),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Sensitivity / Re-analyse across recordings: `replaceAutoSegments` over the whole scene (every
 * manual zoom keeps its place and its id, and no new auto overlaps one or reuses its id), plus the
 * "auto" segments of recordings that are not regenerated. A recording listed without a track has
 * no data to regenerate them from, and one the caller did not list must not lose its zooms.
 */
export function replaceAutoZooms(
  current: ZoomSegment[],
  recordings: readonly RecordingZoomInput[],
  sensitivity: number,
): ZoomSegment[] {
  const regenerated = (z: ZoomSegment): boolean =>
    recordings.some(
      (r) => r.track !== null && z.start >= r.offset && z.start <= r.offset + r.duration,
    );
  const keptAutos = current.filter((z) => z.origin !== "manual" && !regenerated(z));
  const next = replaceAutoSegments(current, detectRecordingZooms(recordings, sensitivity));
  return keptAutos.length === 0 ? next : [...next, ...keptAutos].sort((a, b) => a.start - b.start);
}
