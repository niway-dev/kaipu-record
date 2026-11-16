/**
 * Groups word occurrences into paragraphs for the transcript panel (NIW2-818). Pure and
 * deterministic: the same occurrences always give the same paragraphs with the same ids, so
 * React keys survive a re-projection after an edit.
 *
 * A new paragraph starts when:
 *  - the silence before a word is longer than `gapSeconds` (1.5 s, timeline time);
 *  - the clip changes AND the source is not contiguous: the word starts more than
 *    `sourceGapMs` (300 ms) after the previous one ended, or before the previous one started
 *    (a repeat or a reorder). A plain split keeps the source contiguous, so it never breaks;
 *  - the previous word ends a sentence and the paragraph already holds `minSentenceWords`
 *    (25) words, so short sentences stay together;
 *  - the paragraph already holds `maxWords` (80), a hard cap for text with no punctuation.
 *
 * A sentence end is `.`, `?`, `!` or `…`, optionally followed by closing quotes or brackets.
 * Spanish `¿` and `¡` only open a sentence, so they never count. Abbreviations ("Dr.") are not
 * detected: the 25-word floor keeps their effect small.
 *
 * A paragraph's id is `${wordId}:${clipId}:${start}` of its first occurrence: a repeated word
 * differs by clip and time, and adding words to a paragraph's end leaves its id unchanged.
 */
import type { WordOccurrence } from "./transcript-occurrence";

export interface TranscriptParagraph {
  id: string;
  /** Timeline seconds: the first occurrence's start and the last one's end. */
  start: number;
  end: number;
  occurrences: WordOccurrence[];
}

export interface ParagraphOptions {
  gapSeconds: number;
  sourceGapMs: number;
  minSentenceWords: number;
  maxWords: number;
}

export const DEFAULT_PARAGRAPH_OPTIONS: ParagraphOptions = {
  gapSeconds: 1.5,
  sourceGapMs: 300,
  minSentenceWords: 25,
  maxWords: 80,
};

const SENTENCE_END = /[.?!…]["'”’»)\]]*$/u;

export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

function breaksBetween(
  prev: WordOccurrence,
  next: WordOccurrence,
  countInParagraph: number,
  o: ParagraphOptions,
): boolean {
  if (countInParagraph >= o.maxWords) return true;
  if (next.start - prev.end > o.gapSeconds) return true;
  if (next.clipId !== prev.clipId) {
    const sourceGap = next.sourceStartMs - prev.sourceEndMs;
    if (sourceGap > o.sourceGapMs || next.sourceStartMs < prev.sourceStartMs) return true;
  }
  return countInParagraph >= o.minSentenceWords && endsSentence(prev.text);
}

export function groupParagraphs(
  occurrences: readonly WordOccurrence[],
  opts: Partial<ParagraphOptions> = {},
): TranscriptParagraph[] {
  const options = { ...DEFAULT_PARAGRAPH_OPTIONS, ...opts };
  const paragraphs: TranscriptParagraph[] = [];
  let current: WordOccurrence[] = [];
  const close = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    paragraphs.push({
      id: `${first.wordId}:${first.clipId}:${first.start}`,
      start: first.start,
      end: current[current.length - 1].end,
      occurrences: current,
    });
    current = [];
  };
  for (const occurrence of occurrences) {
    const prev = current[current.length - 1];
    if (prev && breaksBetween(prev, occurrence, current.length, options)) close();
    current.push(occurrence);
  }
  close();
  return paragraphs;
}
