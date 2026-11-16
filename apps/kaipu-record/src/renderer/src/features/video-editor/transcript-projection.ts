/**
 * Transcript projection (NIW2-818, ADR 0063 point 4): maps the stored words of ONE recording
 * to every place they play in the edited timeline. The transcript panel and the SRT/VTT/TXT
 * exports read only the `WordOccurrence`s this returns, so they cannot disagree.
 *
 * Builds on `LayoutEntry` through `sourceRangeToTimelineBlocks` (source-time.ts); the clip
 * mapping is never re-derived here. Units: stored words are integer ms of the recording's own
 * source time; layout, mutes and occurrences are seconds (`start`/`end` on the timeline).
 *
 * Rules:
 *  - `audioMuted` removes every occurrence.
 *  - A word with no duration (end <= start) has nothing to play and is not projected.
 *  - A word that overlaps a muted range by any positive length (more than 1e-6 s) has no
 *    occurrence, however little of it is muted. Muted ranges are source seconds of this
 *    recording and may overlap each other; they are merged before the lookup.
 *  - A word outside every clip has no occurrence. Slides never play words.
 *  - Repeated footage (the same source range on the layout twice) gives one occurrence per
 *    repeat: same `wordId`, own `start`/`end`/`clipId`.
 *  - A word crossing a clip boundary gives ONE occurrence per place, never one per fragment:
 *      1. The pieces of the word on the layout are first joined when they are back to back on
 *         the timeline AND on the source (a plain split: the word stays whole, `clipId` is the
 *         clip where it starts).
 *      2. The piece with the largest share of the word is the word's place; pieces with the
 *         same source range are its repeats, any other piece (the other side of a cut) is
 *         dropped. Ties go to the earlier source time.
 *      3. That piece plays only if it holds at least HALF the word's duration OR at least
 *         120 ms (MIN_BOUNDARY_OVERLAP_SECONDS). Otherwise the word has no occurrence.
 *    The occurrence is the overlap only, mapped to timeline time; `sourceStartMs` and
 *    `sourceEndMs` still copy the stored word.
 *  - Output is sorted by timeline `start`, ties by `sourceStartMs`, then by input order.
 *
 * Joined recordings: there is no shared source axis on this branch (ADR 0058 is not on main),
 * so one recording is projected at a time. When the layout also holds clips of another
 * recording, the caller passes `opts.itemIds`, the item ids of THIS recording's clips: a layout
 * entry whose `itemId` is not in the set is skipped. Without `itemIds` every clip is taken to
 * belong to this recording. No axis offset is applied; mutes are this recording's too.
 *
 * Cost: words are looked up by binary search, each against the few clips that overlap it
 * (clips sorted by source start with a running maximum of source ends) and against the merged
 * muted ranges, so 20,000 words stay far under a second. Words need not be sorted.
 */
import type { TranscriptWord } from "@shared/types/transcription";
import type { MutedRange } from "./audio-edits";
import { sourceRangeToTimelineBlocks, type TimelineBlock } from "./source-time";
import type { LayoutEntry } from "./timeline";
import type { WordOccurrence } from "./transcript-occurrence";

/** A boundary piece this long plays even when it is under half of a long word. */
export const MIN_BOUNDARY_OVERLAP_SECONDS = 0.12;

/** Seconds under which an overlap or a gap is rounding noise (same value as source-time.ts). */
const EPSILON = 1e-6;

export interface ProjectionAudio {
  audioMuted: boolean;
  mutedRanges: MutedRange[];
}

export interface ProjectionOptions {
  /** Item ids of this recording's clips. Other clips on the layout are skipped. */
  itemIds?: ReadonlySet<string>;
}

interface Span {
  start: number;
  end: number;
}

/** Union of the muted ranges: sorted, disjoint, empty and inverted ranges dropped. */
function mergeMutedRanges(ranges: readonly MutedRange[]): Span[] {
  const sorted = ranges
    .filter((r) => r.sourceEnd - r.sourceStart > 0)
    .map((r) => ({ start: r.sourceStart, end: r.sourceEnd }))
    .sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

/** Whether [start, end) overlaps any merged muted range by more than rounding noise. */
function touchesMute(merged: readonly Span[], start: number, end: number): boolean {
  // First range that ends after the word starts; ranges are disjoint so ends ascend too.
  let lo = 0;
  let hi = merged.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (merged[mid].end > start) hi = mid;
    else lo = mid + 1;
  }
  for (let i = lo; i < merged.length && merged[i].start < end; i++) {
    if (Math.min(end, merged[i].end) - Math.max(start, merged[i].start) > EPSILON) return true;
  }
  return false;
}

/** Clips sorted by source start, with the running maximum of their source ends. */
interface ClipIndex {
  clips: LayoutEntry[];
  maxEndUpTo: number[];
}

function indexClips(layout: LayoutEntry[], itemIds: ReadonlySet<string> | undefined): ClipIndex {
  const clips = layout
    .filter((e) => e.kind === "clip" && (!itemIds || itemIds.has(e.itemId)))
    .sort((a, b) => a.sourceStart - b.sourceStart);
  const maxEndUpTo: number[] = [];
  let max = -Infinity;
  for (const clip of clips) {
    max = Math.max(max, clip.sourceEnd);
    maxEndUpTo.push(max);
  }
  return { clips, maxEndUpTo };
}

/** The clips whose source range may overlap [start, end), found without scanning them all. */
function candidateClips(index: ClipIndex, start: number, end: number): LayoutEntry[] {
  // Clips starting before the word ends are a prefix of the sorted list.
  let lo = 0;
  let hi = index.clips.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.clips[mid].sourceStart < end) lo = mid + 1;
    else hi = mid;
  }
  // Walk back until no earlier clip can still reach the word.
  const found: LayoutEntry[] = [];
  for (let i = lo - 1; i >= 0 && index.maxEndUpTo[i] > start; i--) {
    if (index.clips[i].sourceEnd > start) found.push(index.clips[i]);
  }
  return found;
}

const sameSpan = (a: TimelineBlock, b: TimelineBlock): boolean =>
  Math.abs(a.sourceStart - b.sourceStart) <= EPSILON &&
  Math.abs(a.sourceEnd - b.sourceEnd) <= EPSILON;

/** Rule 1: pieces back to back on the timeline and on the source are one piece. */
function joinAdjacent(blocks: TimelineBlock[]): TimelineBlock[] {
  const sorted = [...blocks].sort((a, b) => a.timelineStart - b.timelineStart);
  const joined: TimelineBlock[] = [];
  for (const block of sorted) {
    const last = joined[joined.length - 1];
    if (
      last &&
      Math.abs(block.timelineStart - last.timelineEnd) <= EPSILON &&
      Math.abs(block.sourceStart - last.sourceEnd) <= EPSILON
    ) {
      joined[joined.length - 1] = {
        ...last,
        timelineEnd: block.timelineEnd,
        sourceEnd: block.sourceEnd,
      };
    } else {
      joined.push(block);
    }
  }
  return joined;
}

/** Rules 2 and 3: the places a word plays, from its pieces on the layout. */
function placesOf(blocks: TimelineBlock[], wordSeconds: number): TimelineBlock[] {
  if (blocks.length === 0) return [];
  const pieces = joinAdjacent(blocks);
  let best = pieces[0];
  for (const piece of pieces) {
    const share = piece.sourceEnd - piece.sourceStart;
    const bestShare = best.sourceEnd - best.sourceStart;
    if (
      share > bestShare + EPSILON ||
      (Math.abs(share - bestShare) <= EPSILON && piece.sourceStart < best.sourceStart)
    ) {
      best = piece;
    }
  }
  const overlap = best.sourceEnd - best.sourceStart;
  const plays =
    overlap + EPSILON >= wordSeconds / 2 || overlap + EPSILON >= MIN_BOUNDARY_OVERLAP_SECONDS;
  return plays ? pieces.filter((piece) => sameSpan(piece, best)) : [];
}

export function projectTranscript(
  words: readonly TranscriptWord[],
  layout: LayoutEntry[],
  audio: ProjectionAudio,
  opts: ProjectionOptions = {},
): WordOccurrence[] {
  if (audio.audioMuted || words.length === 0 || layout.length === 0) return [];
  const index = indexClips(layout, opts.itemIds);
  if (index.clips.length === 0) return [];
  const mutes = mergeMutedRanges(audio.mutedRanges);

  const found: { occurrence: WordOccurrence; order: number }[] = [];
  words.forEach((word, order) => {
    if (word.endMs <= word.startMs) return;
    const start = word.startMs / 1000;
    const end = word.endMs / 1000;
    if (touchesMute(mutes, start, end)) return;
    const candidates = candidateClips(index, start, end);
    if (candidates.length === 0) return;
    const blocks = sourceRangeToTimelineBlocks(candidates, start, end);
    for (const place of placesOf(blocks, end - start)) {
      found.push({
        order,
        occurrence: {
          wordId: word.id,
          text: word.text,
          start: place.timelineStart,
          end: place.timelineEnd,
          sourceStartMs: word.startMs,
          sourceEndMs: word.endMs,
          clipId: place.itemId,
        },
      });
    }
  });
  found.sort(
    (a, b) =>
      a.occurrence.start - b.occurrence.start ||
      a.occurrence.sourceStartMs - b.occurrence.sourceStartMs ||
      a.order - b.order,
  );
  return found.map((f) => f.occurrence);
}
