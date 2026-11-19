/**
 * Turns one CLI result (tokens + timestamps + durations, in seconds, relative to the segment)
 * into words in milliseconds. A word starts at a token with a leading space or "▁".
 * Start = first token start; end = last token start + its duration.
 */
import type { Seam, Segment } from "./segment";

export type CliResult = {
  text: string;
  tokens: string[];
  timestamps: number[];
  durations?: number[];
  ys_log_probs?: number[];
};

export type Word = {
  text: string;
  startMs: number;
  endMs: number;
  logProb: number;
  segmentId: number;
};

export function groupTokens(result: CliResult, segment: Segment): Word[] {
  const { tokens, timestamps } = result;
  const durations = result.durations ?? [];
  const logProbs = result.ys_log_probs ?? [];
  const words: Word[] = [];
  let current: { text: string; start: number; end: number; lp: number[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.text.trim();
    if (text.length > 0) {
      const mean = current.lp.length
        ? current.lp.reduce((a, b) => a + b, 0) / current.lp.length
        : 0;
      words.push({
        text,
        startMs: Math.round(segment.startMs + current.start * 1000),
        endMs: Math.round(segment.startMs + current.end * 1000),
        logProb: mean,
        segmentId: segment.id,
      });
    }
    current = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    const startsWord = raw.startsWith(" ") || raw.startsWith("▁");
    const piece = raw.replace(/^[ ▁]/, "");
    const start = timestamps[i] ?? 0;
    const end = start + (durations[i] ?? 0);
    const isPunctuationOnly = /^[\p{P}\p{S}]+$/u.test(piece);
    // Punctuation sticks to the word before it, with or without a space marker.
    if (startsWord && !(isPunctuationOnly && current)) {
      flush();
      current = { text: piece, start, end, lp: [logProbs[i] ?? 0] };
    } else if (current) {
      current.text += piece;
      // Punctuation carries a duration too, but it is not speech: it must not stretch the word.
      if (!isPunctuationOnly) current.end = Math.max(current.end, end);
      current.lp.push(logProbs[i] ?? 0);
    } else {
      current = { text: piece, start, end, lp: [logProbs[i] ?? 0] };
    }
  }
  flush();
  return words;
}

export type ReconcileRule = "spec" | "midpoint" | "midpoint-dedupe";

/**
 * Joins the words of overlapping segments. One cut per seam; each side keeps its own words.
 *
 * - "spec" (the rule the design page wrote): the earlier segment keeps words that start before
 *   the cut, the later one keeps words at or after it; a word that straddles the cut is taken
 *   from the segment where it sits farther from that segment's edge.
 * - "midpoint": the earlier segment keeps words whose midpoint is before the cut, the later one
 *   the rest. No special case, and stable when the same word is timed a frame apart in the two
 *   segments.
 * - "midpoint-dedupe": "midpoint", then a word that repeats its predecessor within 250 ms
 *   (or overlaps it) and lies within 600 ms of a cut is dropped: both sides kept the same word
 *   because they timed it a few frames apart.
 */
export function reconcile(
  segments: Segment[],
  seams: Seam[],
  wordsBySegment: Map<number, Word[]>,
  rule: ReconcileRule = "midpoint",
): Word[] {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const seamAfter = new Map(seams.map((s) => [s.afterId, s])); // shared with the previous segment
  const seamBefore = new Map(seams.map((s) => [s.beforeId, s])); // shared with the next segment
  const out: Word[] = [];
  for (const segment of segments) {
    const words = wordsBySegment.get(segment.id) ?? [];
    const previous = seamAfter.get(segment.id);
    const next = seamBefore.get(segment.id);
    for (const w of words) {
      if (previous && !keepOnLaterSide(byId, previous, w, rule)) continue;
      if (next && keepOnLaterSide(byId, next, w, rule)) continue;
      out.push(w);
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return rule === "midpoint-dedupe" ? dedupeAtSeams(out, seams) : out;
}

function dedupeAtSeams(words: Word[], seams: Seam[]): Word[] {
  const kept: Word[] = [];
  for (const w of words) {
    const previous = kept[kept.length - 1];
    const nearCut = seams.some((s) => Math.abs(w.startMs - s.cutMs) < 600);
    if (
      previous &&
      nearCut &&
      previous.segmentId !== w.segmentId &&
      normalize(previous.text) === normalize(w.text) &&
      w.startMs - previous.endMs < 250
    ) {
      continue;
    }
    kept.push(w);
  }
  return kept;
}

function keepOnLaterSide(
  byId: Map<number, Segment>,
  seam: Seam,
  w: Word,
  rule: ReconcileRule,
): boolean {
  if (rule !== "spec") return (w.startMs + w.endMs) / 2 >= seam.cutMs;
  if (w.startMs >= seam.cutMs) return true;
  if (w.endMs <= seam.cutMs) return false;
  // A straddler: the later segment takes it when it sits farther from that segment's edge.
  const earlier = byId.get(seam.beforeId)!;
  const later = byId.get(seam.afterId)!;
  return earlier.endMs - w.endMs < w.startMs - later.startMs;
}

/** Lowercased letters and digits only, for comparing words across runs. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
