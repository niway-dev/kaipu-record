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
 * Sensitivity / Re-analyse across recordings: the scene's segments with every "auto" one in a
 * recording that has a track replaced by a fresh detection, manual ones kept as
 * `replaceAutoSegments` does. A recording with no track is left alone, auto segments included:
 * there is no data to regenerate them from.
 */
export function replaceAutoZooms(
  current: ZoomSegment[],
  recordings: readonly RecordingZoomInput[],
  sensitivity: number,
): ZoomSegment[] {
  const untouched = (z: ZoomSegment): boolean =>
    recordings.some(
      (r) => r.track === null && z.start >= r.offset && z.start < r.offset + r.duration,
    );
  const kept = current.filter(untouched);
  const rest = replaceAutoSegments(
    current.filter((z) => !untouched(z)),
    detectRecordingZooms(recordings, sensitivity),
  );
  return kept.length === 0 ? rest : [...rest, ...kept].sort((a, b) => a.start - b.start);
}
