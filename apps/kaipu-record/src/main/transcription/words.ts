/**
 * Turns one CLI result (tokens, with timestamps and durations in seconds, relative to the
 * segment) into words in integer milliseconds on the recording's own time axis, and joins the
 * words of overlapping segments into one list.
 */
import type { CliResult } from "./engine/sherpa-supervisor";
import type { Seam, Segment } from "./segment";

export type { CliResult };

export type Word = {
  /** Assigned by `reconcile` (`w1..wn`, in time order); absent on a segment's own words. */
  id?: string;
  segmentId: string;
  text: string;
  startMs: number;
  endMs: number;
  /** Mean token log-probability of the word; 0 when the result carried none. */
  logProb: number;
};
export type IdentifiedWord = Word & { id: string };

/** One model frame: the shortest word the model can time. */
export const MIN_WORD_MS = 80;

const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;
/** Punctuation that opens a phrase belongs to the word after it, not the one before. */
const OPENING_PUNCTUATION = /^[¿¡([{“‘«]+$/u;

type Pending = {
  text: string;
  start: number;
  end: number;
  hasDuration: boolean;
  logProbs: number[];
};

/**
 * A word starts at a token with a leading space or "▁". Start = first token start; end = last
 * speech token start + its duration. Punctuation sticks to the word before it (or the one after,
 * when it opens a phrase) and never stretches the word's end: measured on Spanish, the model
 * gives punctuation a duration that added about 290 ms to word ends. A word whose tokens carry
 * no duration is given one model frame.
 */
export function groupTokens(result: CliResult, segment: Segment): Word[] {
  const { tokens, timestamps } = result;
  const durations = result.durations ?? [];
  const logProbs = result.ys_log_probs ?? [];
  const words: Word[] = [];
  let current: Pending | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.text.trim();
    if (text.length > 0 && !PUNCTUATION_ONLY.test(text)) {
      const startMs = Math.round(segment.startMs + current.start * 1000);
      let endMs = Math.round(segment.startMs + current.end * 1000);
      if (!current.hasDuration) endMs = Math.max(endMs, startMs + MIN_WORD_MS);
      const mean = current.logProbs.length
        ? current.logProbs.reduce((a, b) => a + b, 0) / current.logProbs.length
        : 0;
      words.push({
        segmentId: segment.id,
        text,
        startMs,
        endMs: Math.max(endMs, startMs),
        logProb: mean,
      });
    }
    current = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    const startsWord = raw.startsWith(" ") || raw.startsWith("▁");
    const piece = raw.replace(/^[ ▁]/, "");
    const start = timestamps[i] ?? 0;
    const duration = durations[i];
    const punctuation = PUNCTUATION_ONLY.test(piece);
    const logProb = logProbs[i];

    const append = (into: Pending) => {
      into.text += piece;
      if (!punctuation) {
        into.end = Math.max(into.end, start + (duration ?? 0));
        into.hasDuration ||= (duration ?? 0) > 0;
      }
      if (logProb !== undefined) into.logProbs.push(logProb);
    };
    const begin = (): Pending => ({
      text: piece,
      start,
      end: punctuation ? start : start + (duration ?? 0),
      hasDuration: !punctuation && (duration ?? 0) > 0,
      logProbs: logProb !== undefined ? [logProb] : [],
    });

    if (current === null) {
      current = begin();
    } else if (!startsWord) {
      append(current);
    } else if (punctuation && !OPENING_PUNCTUATION.test(piece)) {
      append(current); // closing punctuation with its own space marker
    } else if (PUNCTUATION_ONLY.test(current.text)) {
      append(current); // leading punctuation waiting for its word
    } else {
      flush();
      current = begin();
    }
  }
  flush();
  return words;
}

/** Lowercased letters and digits only, for comparing the same word across two runs. */
export function normalizeWord(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The same word timed by two runs starts this close (ms) in both. */
const SAME_WORD_START_MS = 250;

/**
 * Joins the words of overlapping segments ("midpoint-dedupe", chosen in M0). Each seam has one
 * cut: the earlier segment keeps the words whose midpoint lies before it, the later one the rest.
 *
 * That rule alone breaks at the cut: a word the two runs time a few frames apart can land on
 * both sides (kept twice) or on the wrong side of each (dropped twice). So inside each overlap
 * the two runs' words are first paired in order, same text and starts within 250 ms, and a pair
 * yields exactly one word, from the run whose side of the cut the pair's midpoint is on. Two
 * real repeats ("no no") pair one to one and both survive. Words with no partner follow the cut
 * rule. Ids `w1..wn` are assigned last, in time order.
 */
export function reconcile(
  segments: Segment[],
  seams: Seam[],
  wordsBySegment: Map<string, Word[]>,
): IdentifiedWord[] {
  const seamAfter = new Map(seams.map((s) => [s.afterId, s])); // shared with the previous segment
  const seamBefore = new Map(seams.map((s) => [s.beforeId, s])); // shared with the next segment
  const forced = new Set<Word>(); // a pair's chosen word: kept whatever side it is on
  const dropped = new Set<Word>(); // a pair's other word
  for (const seam of seams) {
    for (const [earlier, later] of pairOverlapWords(seam, wordsBySegment)) {
      const middle = (earlier.startMs + earlier.endMs + later.startMs + later.endMs) / 4;
      const [chosen, other] = middle < seam.cutMs ? [earlier, later] : [later, earlier];
      forced.add(chosen);
      dropped.add(other);
    }
  }
  const kept: Word[] = [];
  for (const segment of segments) {
    const previous = seamAfter.get(segment.id);
    const next = seamBefore.get(segment.id);
    for (const word of wordsBySegment.get(segment.id) ?? []) {
      if (dropped.has(word)) continue;
      if (!forced.has(word)) {
        if (previous && !onLaterSide(previous, word)) continue;
        if (next && onLaterSide(next, word)) continue;
      }
      kept.push(word);
    }
  }
  kept.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return kept.map((word, index) => ({ ...word, id: `w${index + 1}` }));
}

/** The words both runs heard in a seam's overlap, matched in order. */
function pairOverlapWords(
  seam: Seam,
  wordsBySegment: Map<string, Word[]>,
): Array<[earlier: Word, later: Word]> {
  const inOverlap = (id: string): Word[] =>
    (wordsBySegment.get(id) ?? [])
      .filter((w) => {
        const middle = (w.startMs + w.endMs) / 2;
        return middle >= seam.overlapStartMs && middle <= seam.overlapEndMs;
      })
      .sort((x, y) => x.startMs - y.startMs);
  const earlier = inOverlap(seam.beforeId);
  const later = inOverlap(seam.afterId);
  const pairs: Array<[Word, Word]> = [];
  let i = 0;
  let j = 0;
  while (i < earlier.length && j < later.length) {
    const a = earlier[i]!;
    const b = later[j]!;
    if (
      normalizeWord(a.text) === normalizeWord(b.text) &&
      Math.abs(a.startMs - b.startMs) < SAME_WORD_START_MS
    ) {
      pairs.push([a, b]);
      i++;
      j++;
    } else if (a.startMs <= b.startMs) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

function onLaterSide(seam: Seam, word: Word): boolean {
  return (word.startMs + word.endMs) / 2 >= seam.cutMs;
}
