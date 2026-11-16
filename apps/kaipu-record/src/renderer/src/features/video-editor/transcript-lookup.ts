/**
 * Lookups over the sorted occurrences `projectTranscript` returns (NIW2-818): what plays at a
 * timeline time, where to seek for a clicked word, and text search. Pure; the panel memoises
 * on the occurrences array.
 */
import type { WordOccurrence } from "./transcript-occurrence";

/** A word stays "current" this long after it ends, so the highlight does not flicker in gaps. */
export const CURRENT_WORD_GRACE_SECONDS = 0.25;

/**
 * Index of the occurrence playing at timeline time `t`: the last one with `start <= t`, while
 * `t < end + 0.25 s`; -1 before the first word, in a longer silence, and after the last word.
 * `occurrences` must be sorted by `start`, as the projection returns them.
 */
export function occurrenceAtTime(occurrences: readonly WordOccurrence[], t: number): number {
  let lo = 0;
  let hi = occurrences.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (occurrences[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  const index = lo - 1;
  if (index < 0) return -1;
  return t < occurrences[index].end + CURRENT_WORD_GRACE_SECONDS ? index : -1;
}

/**
 * Among the repeats of one word id, the occurrence nearest to timeline time `near` (distance to
 * its [start, end] span, so a time inside it is 0; the earlier one wins a tie), or null when the
 * word has no occurrence. Returns the occurrence, not an index: the caller seeks to `start`.
 */
export function occurrenceForSeek(
  occurrences: readonly WordOccurrence[],
  wordId: string,
  near: number,
): WordOccurrence | null {
  let best: WordOccurrence | null = null;
  let bestDistance = Infinity;
  for (const occurrence of occurrences) {
    if (occurrence.wordId !== wordId) continue;
    const distance = Math.max(occurrence.start - near, near - occurrence.end, 0);
    if (distance < bestDistance) {
      best = occurrence;
      bestDistance = distance;
    }
  }
  return best;
}

/** Lowercase, accents removed, only letters and digits kept: "Canción," becomes "cancion". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Indices of the first word of every match of `query`, case- and accent-insensitive and
 * ignoring punctuation. The query may span neighbouring words ("cancion de") and may be a part
 * of a word (so results narrow while typing). Words that are only punctuation are skipped.
 * Each starting word appears once, in order. An empty query matches nothing.
 */
export function searchOccurrences(occurrences: readonly WordOccurrence[], query: string): number[] {
  const needle = query.split(/\s+/).map(fold).filter(Boolean).join(" ");
  if (!needle) return [];
  let haystack = "";
  const starts: number[] = [];
  const indices: number[] = [];
  occurrences.forEach((occurrence, index) => {
    const folded = fold(occurrence.text);
    if (!folded) return;
    if (haystack) haystack += " ";
    starts.push(haystack.length);
    indices.push(index);
    haystack += folded;
  });
  const matches: number[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, from)) {
    // The word holding offset `at`: the last one that starts at or before it.
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= at) lo = mid + 1;
      else hi = mid;
    }
    const index = indices[lo - 1];
    if (matches[matches.length - 1] !== index) matches.push(index);
    from = at + 1;
  }
  return matches;
}
