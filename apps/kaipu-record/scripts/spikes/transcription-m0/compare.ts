/**
 * Word-level comparison of a run against a reference run (the same audio decoded in one pass),
 * as an edit distance over normalized words. Counts only; no text leaves this function.
 * `inserted` are words the run has and the reference does not (a duplicated boundary word shows
 * up here); `deleted` are reference words the run lost; `substituted` are changed words.
 */
import { normalize, type Word } from "./words";

export type Comparison = {
  referenceWords: number;
  runWords: number;
  inserted: number;
  deleted: number;
  substituted: number;
  /** (inserted + deleted + substituted) / referenceWords */
  wordErrorRate: number;
};

export function compareWords(reference: Word[], run: Word[]): Comparison {
  const a = reference.map((w) => normalize(w.text)).filter(Boolean);
  const b = run.map((w) => normalize(w.text)).filter(Boolean);
  const n = a.length;
  const m = b.length;
  // Rows of [cost, inserted, deleted, substituted].
  let prev = Array.from({ length: m + 1 }, (_, j) => [j, j, 0, 0]);
  for (let i = 1; i <= n; i++) {
    const row: number[][] = [[i, 0, i, 0]];
    for (let j = 1; j <= m; j++) {
      const same = a[i - 1] === b[j - 1];
      const diag = prev[j - 1]!;
      const up = prev[j]!; // reference word with no partner: deleted
      const left = row[j - 1]!; // run word with no partner: inserted
      const candidates = [
        { cost: diag[0]! + (same ? 0 : 1), from: diag, kind: same ? -1 : 3 },
        { cost: up[0]! + 1, from: up, kind: 2 },
        { cost: left[0]! + 1, from: left, kind: 1 },
      ];
      const best = candidates.reduce((x, y) => (y.cost < x.cost ? y : x));
      const next = [best.cost, best.from[1]!, best.from[2]!, best.from[3]!];
      if (best.kind >= 0) next[best.kind] = next[best.kind]! + 1;
      row.push(next);
    }
    prev = row;
  }
  const [cost, inserted, deleted, substituted] = prev[m]!;
  return {
    referenceWords: n,
    runWords: m,
    inserted: inserted!,
    deleted: deleted!,
    substituted: substituted!,
    wordErrorRate: Math.round((cost! / Math.max(1, n)) * 10000) / 10000,
  };
}

/** Consecutive identical words less than 400 ms apart: what a doubled boundary word looks like. */
export function adjacentDuplicates(words: Word[]): number {
  let count = 0;
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1]!;
    const b = words[i]!;
    const text = normalize(a.text);
    if (text && text === normalize(b.text) && b.startMs - a.endMs < 400) count++;
  }
  return count;
}

export type TimingError = {
  matched: number;
  of: number;
  startMedianMs: number;
  startP95Ms: number;
  startBiasMs: number;
  endMedianMs: number;
  endP95Ms: number;
  endBiasMs: number;
};

/** Word start and end against known marks, matching in order on the normalized text. */
export function timingError(
  marks: { text: string; startMs: number; endMs: number }[],
  words: Word[],
): TimingError {
  const startErrors: number[] = [];
  const endErrors: number[] = [];
  let at = 0;
  for (const mark of marks) {
    const want = normalize(mark.text);
    for (let j = at; j < Math.min(words.length, at + 3); j++) {
      if (normalize(words[j]!.text) === want) {
        startErrors.push(words[j]!.startMs - mark.startMs);
        endErrors.push(words[j]!.endMs - mark.endMs);
        at = j + 1;
        break;
      }
    }
  }
  const abs = (xs: number[]) => xs.map(Math.abs).sort((a, b) => a - b);
  const pick = (xs: number[], q: number) =>
    xs[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0;
  const mean = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  const sa = abs(startErrors);
  const ea = abs(endErrors);
  return {
    matched: startErrors.length,
    of: marks.length,
    startMedianMs: pick(sa, 0.5),
    startP95Ms: pick(sa, 0.95),
    startBiasMs: mean(startErrors),
    endMedianMs: pick(ea, 0.5),
    endP95Ms: pick(ea, 0.95),
    endBiasMs: mean(endErrors),
  };
}
