import { describe, expect, it } from "vitest";
import type { WordOccurrence } from "./transcript-occurrence";
import { occurrenceAtTime, occurrenceForSeek, searchOccurrences } from "./transcript-lookup";

function occ(
  wordId: string,
  start: number,
  end: number,
  text = wordId,
  clipId = "a",
): WordOccurrence {
  return {
    wordId,
    text,
    start,
    end,
    sourceStartMs: Math.round(start * 1000),
    sourceEndMs: Math.round(end * 1000),
    clipId,
  };
}

describe("occurrenceAtTime", () => {
  const words = [occ("a", 1, 1.4), occ("b", 1.5, 1.9), occ("c", 5, 5.4)];

  it("returns the last occurrence that started, while it plays", () => {
    expect(occurrenceAtTime(words, 1)).toBe(0);
    expect(occurrenceAtTime(words, 1.2)).toBe(0);
    expect(occurrenceAtTime(words, 1.5)).toBe(1);
    expect(occurrenceAtTime(words, 1.8)).toBe(1);
  });

  it("keeps the word highlighted for 0.25 s after it ends, then lets go", () => {
    expect(occurrenceAtTime(words, 1.4 + 0.2)).toBe(1); // b started at 1.5
    expect(occurrenceAtTime(words, 1.9 + 0.24)).toBe(1);
    expect(occurrenceAtTime(words, 1.9 + 0.25)).toBe(-1);
    expect(occurrenceAtTime(words, 3)).toBe(-1);
  });

  it("is -1 before the first word, after the last one and for no words", () => {
    expect(occurrenceAtTime(words, 0.5)).toBe(-1);
    expect(occurrenceAtTime(words, 9)).toBe(-1);
    expect(occurrenceAtTime([], 1)).toBe(-1);
  });

  it("finds the right word in a long list", () => {
    const many = Array.from({ length: 50_000 }, (_, i) => occ(`w${i}`, i * 0.5, i * 0.5 + 0.4));
    expect(occurrenceAtTime(many, 12_345.1)).toBe(24_690);
  });
});

describe("occurrenceForSeek", () => {
  const repeats = [
    occ("hola", 1, 1.4, "hola", "first"),
    occ("otra", 3, 3.4),
    occ("hola", 20, 20.4, "hola", "again"),
  ];

  it("picks the repeat closest to the given timeline time", () => {
    expect(occurrenceForSeek(repeats, "hola", 2)?.clipId).toBe("first");
    expect(occurrenceForSeek(repeats, "hola", 15)?.clipId).toBe("again");
    expect(occurrenceForSeek(repeats, "hola", 100)?.clipId).toBe("again");
  });

  it("measures the distance to the word's span, and prefers the earlier on a tie", () => {
    expect(occurrenceForSeek(repeats, "hola", 20.2)?.clipId).toBe("again");
    // Binary-exact values: 10.75 is exactly 9.25 from the first one's end (1.5) and exactly 9.25
    // from the second one's start (20), so only `distance < bestDistance` picks the earlier.
    const tie = [occ("hola", 1, 1.5, "hola", "first"), occ("hola", 20, 20.5, "hola", "again")];
    expect(occurrenceForSeek(tie, "hola", 10.75)?.clipId).toBe("first");
  });

  it("is null for an unknown word id", () => {
    expect(occurrenceForSeek(repeats, "nope", 1)).toBeNull();
    expect(occurrenceForSeek([], "hola", 1)).toBeNull();
  });
});

describe("searchOccurrences", () => {
  const words = ["La", "canción,", "de", "Ángel", "es", "buena."].map((t, i) =>
    occ(`w${i}`, i, i + 0.4, t),
  );

  it("is case- and accent-insensitive: cancion finds canción", () => {
    expect(searchOccurrences(words, "cancion")).toEqual([1]);
    expect(searchOccurrences(words, "CANCIÓN")).toEqual([1]);
    expect(searchOccurrences(words, "angel")).toEqual([3]);
  });

  it("matches a phrase across two neighbouring words, ignoring punctuation", () => {
    expect(searchOccurrences(words, "cancion de")).toEqual([1]);
    expect(searchOccurrences(words, "la cancion de angel")).toEqual([0]);
    expect(searchOccurrences(words, "de   ángel")).toEqual([2]);
  });

  it("does not match words that are not neighbours", () => {
    expect(searchOccurrences(words, "cancion angel")).toEqual([]);
  });

  it("finds a partial word as the user types", () => {
    expect(searchOccurrences(words, "canc")).toEqual([1]);
  });

  it("returns the first word of every match, once each", () => {
    const text = ["a", "banana", "a", "banana"].map((t, i) => occ(`x${i}`, i, i + 0.4, t));
    expect(searchOccurrences(text, "ana")).toEqual([1, 3]);
    expect(searchOccurrences(text, "a banana")).toEqual([0, 2]);
  });

  it("returns nothing for an empty or punctuation-only query", () => {
    expect(searchOccurrences(words, "")).toEqual([]);
    expect(searchOccurrences(words, "   ")).toEqual([]);
    expect(searchOccurrences(words, ",.")).toEqual([]);
    expect(searchOccurrences([], "hola")).toEqual([]);
  });

  it("skips words that are only punctuation without breaking a phrase", () => {
    const dashed = ["hola", "—", "mundo"].map((t, i) => occ(`d${i}`, i, i + 0.4, t));
    expect(searchOccurrences(dashed, "hola mundo")).toEqual([0]);
  });
});
