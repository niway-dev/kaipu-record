/**
 * Turns one CLI result (tokens, with timestamps and durations in seconds, relative to the
 * segment) into words in integer milliseconds on the recording's own time axis, and joins the
 * words of overlapping segments into one list.
 */
import type { Seam, Segment } from "./segment";

/** The fields of the `sherpa-onnx-offline` JSON result that word grouping reads. */
export type CliResult = {
  text: string;
  tokens: string[];
  timestamps: number[];
  durations?: number[];
  ys_log_probs?: number[];
};

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

/** A repeat of the previous word this close to it (ms) is the same word timed twice. */
const DUPLICATE_GAP_MS = 250;
/** Only words this close to a cut (ms) can be duplicates created by the overlap. */
const DUPLICATE_NEAR_CUT_MS = 600;

/**
 * Joins the words of overlapping segments ("midpoint-dedupe", chosen in M0). Each seam has one
 * cut: the earlier segment keeps the words whose midpoint lies before it, the later one the rest.
 * A word timed a few frames apart by the two runs can still land on both sides of the cut, so a
 * word that repeats its predecessor from another segment, within 250 ms and within 600 ms of a
 * cut, is dropped. Ids `w1..wn` are assigned last, in time order.
 */
export function reconcile(
  segments: Segment[],
  seams: Seam[],
  wordsBySegment: Map<string, Word[]>,
): IdentifiedWord[] {
  const seamAfter = new Map(seams.map((s) => [s.afterId, s])); // shared with the previous segment
  const seamBefore = new Map(seams.map((s) => [s.beforeId, s])); // shared with the next segment
  const kept: Word[] = [];
  for (const segment of segments) {
    const previous = seamAfter.get(segment.id);
    const next = seamBefore.get(segment.id);
    for (const word of wordsBySegment.get(segment.id) ?? []) {
      if (previous && !onLaterSide(previous, word)) continue;
      if (next && onLaterSide(next, word)) continue;
      kept.push(word);
    }
  }
  kept.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return dedupeAtSeams(kept, seams).map((word, index) => ({ ...word, id: `w${index + 1}` }));
}

function onLaterSide(seam: Seam, word: Word): boolean {
  return (word.startMs + word.endMs) / 2 >= seam.cutMs;
}

function dedupeAtSeams(words: Word[], seams: Seam[]): Word[] {
  const out: Word[] = [];
  for (const word of words) {
    const previous = out[out.length - 1];
    const nearCut = seams.some((s) => Math.abs(word.startMs - s.cutMs) < DUPLICATE_NEAR_CUT_MS);
    if (
      previous &&
      nearCut &&
      previous.segmentId !== word.segmentId &&
      normalizeWord(previous.text) === normalizeWord(word.text) &&
      word.startMs - previous.endMs < DUPLICATE_GAP_MS
    ) {
      continue;
    }
    out.push(word);
  }
  return out;
}
