import { describe, expect, it } from "vitest";
import type { WordOccurrence } from "../transcript-occurrence";
import { formatTxt } from "./txt";

function occurrences(texts: string[]): WordOccurrence[] {
  return texts.map((text, i) => ({
    wordId: `w${i}`,
    text,
    start: i,
    end: i + 0.5,
    sourceStartMs: i * 1000,
    sourceEndMs: i * 1000 + 500,
    clipId: "clip-a",
  }));
}

describe("formatTxt", () => {
  it("writes one paragraph per item, separated by a blank line, with a trailing newline", () => {
    expect(
      formatTxt([
        { occurrences: occurrences(["Hola", "mundo."]) },
        { occurrences: occurrences(["¿Qué", "tal?"]) },
      ]),
    ).toBe("Hola mundo.\n\n¿Qué tal?\n");
  });

  it("joins words with single spaces and normalizes whitespace", () => {
    expect(formatTxt([{ occurrences: occurrences(["  a ", "b\t c", " ", "d"]) }])).toBe(
      "a b c d\n",
    );
  });

  it("drops empty paragraphs", () => {
    expect(
      formatTxt([
        { occurrences: [] },
        { occurrences: occurrences(["one"]) },
        { occurrences: occurrences([" "]) },
      ]),
    ).toBe("one\n");
  });

  it("gives an empty string for no paragraphs", () => {
    expect(formatTxt([])).toBe("");
  });
});
