import type { WordOccurrence } from "../transcript-occurrence";

/**
 * Subtitle cues, rebuilt from the words that survive the edit (NIW2-818, ADR 0065 point 5).
 * Cues are never cut from stored sentences: a deleted, muted or repeated stretch changes which
 * words arrive here, and the cues follow.
 *
 * Every limit below is a default of `DEFAULT_CUE_LIMITS` and can be overridden per call.
 *
 * - `maxLineChars` (42): the widely used broadcast limit for one subtitle line. A single word
 *   longer than this stays alone on its line; words are never hyphenated or split.
 * - `maxLines` (2): a cue is one or two lines. Only 1 and 2 are meaningful; larger values behave
 *   as 2.
 * - `maxCharsPerSecond` (20): reading speed. It never splits a cue (splitting only makes it
 *   worse); a cue that reads too fast is extended into the silence after it, see below.
 * - `minDuration` (0.8 s): shortest a cue should stay on screen, reached by the same extension.
 * - `maxDuration` (7 s): longest a cue stays on screen. A run of words spanning more than this
 *   is split, and an extension never lengthens a cue past it.
 * - `maxPause` (0.6 s): a gap between one word's end and the next word's start (timeline time)
 *   longer than this ends the cue.
 * - `maxSourceSkipMs` (300 ms): the next word starting in its recording more than this after the
 *   previous word ended means material was cut out between them, so the cue splits even when the
 *   timeline is contiguous.
 *
 * Constants that are not limits:
 *
 * - `CUE_GAP` (0.04 s): the room kept between a cue that was extended and the next cue.
 * - `SOURCE_BACKWARDS_TOLERANCE_MS` (100 ms): the next word starting in its recording earlier
 *   than the previous word's end by more than this counts as the source going backwards
 *   (repeated footage), and splits. Smaller overlaps are timestamp rounding in the recognizer.
 *
 * Cues break (hard), in this order of reading the words:
 *
 * 1. after a word ending in sentence punctuation (`. ? ! …`, optionally followed by closing
 *    quotes or brackets),
 * 2. at a pause over `maxPause`,
 * 3. at every timeline discontinuity: a change of `clipId`, the source going backwards, or the
 *    source skipping forward more than `maxSourceSkipMs`,
 * 4. when the next word would push a line or the cue past the limits. That break prefers the last
 *    comma, semicolon or colon when it keeps at least half of the text.
 *
 * Timing: a cue starts with its first word and ends with its last word. A cue that reads faster
 * than `maxCharsPerSecond`, or is shorter than `minDuration`, is extended into the silence after
 * it, to the duration it needs, never past `maxDuration`, never past the next cue's start minus
 * `CUE_GAP`. When the room is not there the shorter cue is kept. A cue followed by a cut (the
 * next word plays in another clip) is not extended: where its clip ends is unknown, and a stale
 * caption over the next clip's footage is worse than a short one. The last cue is extended with
 * no room limit: nothing follows it, and a cue that outlasts the video is harmless. Cues never
 * overlap: if the recognizer's words overlap, the later cue starts when the earlier one ends.
 */
export interface CueLimits {
  maxLineChars: number;
  maxLines: number;
  maxCharsPerSecond: number;
  minDuration: number;
  maxDuration: number;
  maxPause: number;
  maxSourceSkipMs: number;
}

export const DEFAULT_CUE_LIMITS: CueLimits = {
  maxLineChars: 42,
  maxLines: 2,
  maxCharsPerSecond: 20,
  minDuration: 0.8,
  maxDuration: 7,
  maxPause: 0.6,
  maxSourceSkipMs: 300,
};

/** Timeline seconds; `index` is 1-based; one or two `lines`. */
export interface Cue {
  index: number;
  start: number;
  end: number;
  lines: string[];
}

const CUE_GAP = 0.04;
const SOURCE_BACKWARDS_TOLERANCE_MS = 100;
const EPSILON = 1e-9;
const SENTENCE_END = /[.?!…]["'”’»›)\]}]*$/u;
const CLAUSE_END = /[,;:]["'”’»›)\]}]*$/u;

interface Word {
  text: string;
  start: number;
  end: number;
  sourceStartMs: number;
  sourceEndMs: number;
  clipId: string;
}

export function buildCues(
  occurrences: readonly WordOccurrence[],
  opts: Partial<CueLimits> = {},
): Cue[] {
  const limits: CueLimits = { ...DEFAULT_CUE_LIMITS, ...opts };
  const words = occurrences.flatMap((o): Word[] => {
    const text = o.text.replace(/\s+/g, " ").trim();
    return text === "" ? [] : [{ ...o, text }];
  });

  const groups: Word[][] = [];
  for (const run of splitAtHardBreaks(words, limits)) groups.push(...splitToFit(run, limits));
  return time(groups, limits);
}

function splitAtHardBreaks(words: Word[], limits: CueLimits): Word[][] {
  const runs: Word[][] = [];
  let current: Word[] = [];
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && isBreakBetween(previous, word, limits)) {
      runs.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function isBreakBetween(previous: Word, next: Word, limits: CueLimits): boolean {
  if (SENTENCE_END.test(previous.text)) return true;
  if (next.start - previous.end > limits.maxPause + EPSILON) return true;
  if (next.clipId !== previous.clipId) return true;
  const sourceSkip = next.sourceStartMs - previous.sourceEndMs;
  return sourceSkip > limits.maxSourceSkipMs || sourceSkip < -SOURCE_BACKWARDS_TOLERANCE_MS;
}

/** Greedily fills cues from a run, breaking when the layout or the duration no longer fits. */
function splitToFit(run: Word[], limits: CueLimits): Word[][] {
  const groups: Word[][] = [];
  let from = 0;
  while (from < run.length) {
    let to = from + 1;
    while (to < run.length && fits(run, from, to + 1, limits)) to++;
    if (to < run.length) to = preferClauseBreak(run, from, to);
    groups.push(run.slice(from, to));
    from = to;
  }
  return groups;
}

function fits(run: Word[], from: number, to: number, limits: CueLimits): boolean {
  const span = run[to - 1]!.end - run[from]!.start;
  if (span > limits.maxDuration + EPSILON) return false;
  return (
    layoutLines(
      run.slice(from, to).map((w) => w.text),
      limits,
    ) !== null
  );
}

/** Moves a forced break back to the last clause end when that keeps at least half the text. */
function preferClauseBreak(run: Word[], from: number, to: number): number {
  const length = (end: number) =>
    run.slice(from, end).reduce((sum, w) => sum + w.text.length + 1, 0);
  const total = length(to);
  for (let end = to - 1; end > from; end--) {
    if (CLAUSE_END.test(run[end - 1]!.text)) return length(end) * 2 >= total ? end : to;
  }
  return to;
}

/** One or two lines within the limits, or null when the words do not fit. */
function layoutLines(words: string[], limits: CueLimits): string[] | null {
  const lineFits = (line: string[]) =>
    line.length === 1 || line.join(" ").length <= limits.maxLineChars;
  if (lineFits(words)) return [words.join(" ")];
  if (limits.maxLines < 2) return null;
  let best: { lines: string[]; score: number } | null = null;
  for (let split = 1; split < words.length; split++) {
    const first = words.slice(0, split);
    const second = words.slice(split);
    if (!lineFits(first) || !lineFits(second)) continue;
    const firstText = first.join(" ");
    const secondText = second.join(" ");
    const score =
      Math.abs(firstText.length - secondText.length) - (CLAUSE_END.test(firstText) ? 10 : 0);
    if (!best || score < best.score) best = { lines: [firstText, secondText], score };
  }
  return best ? best.lines : null;
}

function time(groups: Word[][], limits: CueLimits): Cue[] {
  const cues: Cue[] = [];
  let previousEnd = -Infinity;
  groups.forEach((group, i) => {
    const lines = layoutLines(
      group.map((w) => w.text),
      limits,
    ) ?? [group.map((w) => w.text).join(" ")];
    const start = Math.max(group[0]!.start, previousEnd);
    let end = Math.max(group[group.length - 1]!.end, start);

    const next = groups[i + 1];
    const characters = lines.join(" ").length;
    const needed = Math.min(
      limits.maxDuration,
      Math.max(limits.minDuration, characters / limits.maxCharsPerSecond),
    );
    const last = group[group.length - 1]!;
    const room = !next
      ? Infinity
      : next[0]!.clipId !== last.clipId
        ? end
        : next[0]!.start - CUE_GAP;
    end = Math.max(end, Math.min(start + needed, room));
    cues.push({ index: i + 1, start, end, lines });
    previousEnd = end;
  });
  return cues;
}
