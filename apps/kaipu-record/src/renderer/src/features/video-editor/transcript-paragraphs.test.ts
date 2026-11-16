import { describe, expect, it } from "vitest";
import type { WordOccurrence } from "./transcript-occurrence";
import { groupParagraphs } from "./transcript-paragraphs";

/** A 0.4 s word at timeline `start`, in source ms that mirror the timeline unless given. */
function occ(wordId: string, start: number, extra: Partial<WordOccurrence> = {}): WordOccurrence {
  return {
    wordId,
    text: wordId,
    start,
    end: start + 0.4,
    sourceStartMs: Math.round(start * 1000),
    sourceEndMs: Math.round((start + 0.4) * 1000),
    clipId: "a",
    ...extra,
  };
}

/** `n` back-to-back words, ids `${prefix}0..`. */
function run(n: number, prefix = "w", from = 0): WordOccurrence[] {
  return Array.from({ length: n }, (_, i) => occ(`${prefix}${i}`, from + i * 0.5));
}

describe("groupParagraphs", () => {
  it("returns nothing for no words and one paragraph for a short run", () => {
    expect(groupParagraphs([])).toEqual([]);
    const words = run(5);
    const [only, ...rest] = groupParagraphs(words);
    expect(rest).toEqual([]);
    expect(only.occurrences).toEqual(words);
    expect(only.start).toBe(0);
    expect(only.end).toBeCloseTo(2.4, 9);
  });

  it("starts a paragraph at a gap larger than 1.5 s, not at exactly 1.5 s", () => {
    const first = [occ("a", 0), occ("b", 0.5)];
    const exact = occ("c", 0.9 + 1.5);
    expect(groupParagraphs([...first, exact])).toHaveLength(1);
    const over = occ("c", 0.9 + 1.6);
    const paragraphs = groupParagraphs([...first, over]);
    expect(paragraphs.map((p) => p.occurrences.map((o) => o.wordId))).toEqual([["a", "b"], ["c"]]);
  });

  it("starts a paragraph at a clip change whose source is not contiguous", () => {
    const a1 = occ("a1", 0, { clipId: "a", sourceStartMs: 1000, sourceEndMs: 1400 });
    // Same clip change but the source continues right after (a plain split): no break.
    const contiguous = occ("a2", 0.4, { clipId: "b", sourceStartMs: 1400, sourceEndMs: 1800 });
    expect(groupParagraphs([a1, contiguous])).toHaveLength(1);
    // 300 ms of cut footage is still contiguous; 301 ms is not.
    const near = occ("a2", 0.4, { clipId: "b", sourceStartMs: 1700, sourceEndMs: 2100 });
    expect(groupParagraphs([a1, near])).toHaveLength(1);
    const far = occ("a2", 0.4, { clipId: "b", sourceStartMs: 1701, sourceEndMs: 2100 });
    expect(groupParagraphs([a1, far])).toHaveLength(2);
    // Source going backwards (a repeat or a reorder).
    const back = occ("a2", 0.4, { clipId: "b", sourceStartMs: 200, sourceEndMs: 600 });
    expect(groupParagraphs([a1, back])).toHaveLength(2);
  });

  it("does not break on a source gap inside the same clip", () => {
    const a1 = occ("a1", 0, { sourceStartMs: 1000, sourceEndMs: 1400 });
    const a2 = occ("a2", 0.5, { sourceStartMs: 5000, sourceEndMs: 5400 });
    expect(groupParagraphs([a1, a2])).toHaveLength(1);
  });

  it("breaks after a sentence end only once the paragraph holds 25 words", () => {
    const early = run(24).map((o, i) => (i === 9 ? { ...o, text: "done." } : o));
    expect(groupParagraphs(early)).toHaveLength(1);

    const words = run(30).map((o, i) => (i === 24 ? { ...o, text: "listo." } : o));
    const paragraphs = groupParagraphs(words);
    expect(paragraphs.map((p) => p.occurrences.length)).toEqual([25, 5]);
  });

  it("recognises question marks, exclamations, ellipses and closing quotes as sentence ends", () => {
    for (const ender of ["¿cómo?", "¡sí!", "bueno…", "y luego...", 'dijo "no."', "fin.)", "ok?»"]) {
      const words = run(30).map((o, i) => (i === 24 ? { ...o, text: ender } : o));
      expect(groupParagraphs(words).map((p) => p.occurrences.length)).toEqual([25, 5]);
    }
    for (const notEnder of ["¿cómo", "¡sí", "coma,", "plain"]) {
      const words = run(30).map((o, i) => (i === 24 ? { ...o, text: notEnder } : o));
      expect(groupParagraphs(words)).toHaveLength(1);
    }
  });

  it("caps a paragraph at 80 words", () => {
    const paragraphs = groupParagraphs(run(200));
    expect(paragraphs.map((p) => p.occurrences.length)).toEqual([80, 80, 40]);
  });

  it("gives paragraphs ids that survive re-projection and differ between paragraphs", () => {
    const words = [...run(3, "a"), ...run(3, "b", 10)];
    const first = groupParagraphs(words);
    const again = groupParagraphs(words.map((o) => ({ ...o })));
    expect(first.map((p) => p.id)).toEqual(again.map((p) => p.id));
    expect(new Set(first.map((p) => p.id)).size).toBe(2);
    // Appending words to the end of a paragraph does not change its id.
    const grown = groupParagraphs([...run(3, "a"), occ("a3", 1.5)]);
    expect(grown[0].id).toBe(first[0].id);
  });

  it("tells the same word on two repeats apart in the id", () => {
    const one = occ("hola", 1, { clipId: "first" });
    const two = occ("hola", 8, { clipId: "again" });
    const ids = groupParagraphs([one, two]).map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("accepts overrides for the constants", () => {
    const paragraphs = groupParagraphs(run(10), { maxWords: 4 });
    expect(paragraphs.map((p) => p.occurrences.length)).toEqual([4, 4, 2]);
  });
});
