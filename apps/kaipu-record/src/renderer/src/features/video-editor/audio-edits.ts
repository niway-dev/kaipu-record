/**
 * Muting, as an edit rather than a playback setting.
 *
 * The editor already had a mute — the preview player's, which does not reach the
 * exported file. This is the other one: ranges the user chose to silence, saved
 * with the session and burned into the export as real silence.
 *
 * Ranges are anchored to the SOURCE, exactly like zoom segments and redactions.
 * Cut three seconds out of the middle of a recording and a timeline-anchored
 * mute would slide onto different audio and stop covering the thing it was put
 * there to cover; a source-anchored one travels with it. If the footage it
 * points at is deleted the range simply stops applying, and comes back with an
 * undo.
 *
 * Overlaps are allowed and never merged on input. Zero added to zero a thousand
 * times is still zero, so two ranges covering the same second cost nothing to
 * keep, and not merging means an undo restores exactly what the user drew.
 */

/** A silenced span of the ORIGINAL recording, in source seconds. End is exclusive. */
export interface MutedRange {
  id: string;
  sourceStart: number;
  sourceEnd: number;
}

/** The audio half of a scene — the two fields the rest of this module reads. */
export interface AudioEdits {
  /**
   * The whole recording is silent. Deliberately NOT "a range covering
   * everything": the export drops the audio track entirely for this, producing
   * a smaller file with no dead volume control, and inferring that from ranges
   * would never be exact once cuts and fractional seconds are involved.
   */
  audioMuted: boolean;
  mutedRanges: MutedRange[];
}

/** Whether the source plays sound at this instant. Drives the preview. */
export function isAudible(sourceTime: number, edits: AudioEdits): boolean {
  if (edits.audioMuted) return false;
  return !edits.mutedRanges.some(
    (range) => sourceTime >= range.sourceStart && sourceTime < range.sourceEnd,
  );
}

/** A silenced span, clipped to one segment of source footage. */
export interface SilencedSpan {
  start: number;
  end: number;
}

/**
 * The spans of `[segmentStart, segmentEnd)` the export must write as silence.
 *
 * Merged and sorted here, unlike on input: the export walks them in order to
 * decide sample by sample what to copy and what to zero, and overlapping spans
 * would make it write the same stretch twice and drift the audio cursor.
 */
export function silencedSpansFor(
  segmentStart: number,
  segmentEnd: number,
  edits: AudioEdits,
): SilencedSpan[] {
  if (edits.audioMuted) return [{ start: segmentStart, end: segmentEnd }];

  const clipped = edits.mutedRanges
    .map((range) => ({
      start: Math.max(range.sourceStart, segmentStart),
      end: Math.min(range.sourceEnd, segmentEnd),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const merged: SilencedSpan[] = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}
