import { describe, expect, it } from "vitest";

import { TEXT_LINE_HEIGHT, textBoxPx, textLines } from "./tools";

describe("textLines", () => {
  it("returns a single line when there is no break", () => {
    expect(textLines("hello")).toEqual(["hello"]);
  });

  it("splits on every newline, keeping empty lines", () => {
    expect(textLines("a\nb\n\nc")).toEqual(["a", "b", "", "c"]);
  });
});

describe("textLines", () => {
  // fs 10 → char advance 5.5px → width 55px ≈ 10 chars per line.
  const fs = 10;
  const width = 55;

  it("without a width, breaks only on explicit newlines", () => {
    expect(textLines("one two three four", fs)).toEqual(["one two three four"]);
    expect(textLines("a\nb", fs)).toEqual(["a", "b"]);
  });

  it("word-wraps to the width, whole words only", () => {
    expect(textLines("one two three four", fs, width)).toEqual(["one two", "three four"]);
  });

  // A word that cannot fit on a line of its own has nowhere to go: leaving it whole
  // runs it past the box that the outline, hit-test and export all measure from.
  it("breaks a word wider than the box instead of letting it overflow", () => {
    expect(textLines("abcdefghijklmno pq", fs, width)).toEqual(["abcdefghij", "klmno pq"]);
  });

  it("breaks a long word that follows text on the same line", () => {
    expect(textLines("hi abcdefghijklmnopqr", fs, width)).toEqual(["hi", "abcdefghij", "klmnopqr"]);
  });

  it("keeps breaking a word many times its width", () => {
    expect(textLines("a".repeat(25), fs, width)).toEqual(["a".repeat(10), "a".repeat(10), "aaaaa"]);
  });

  it("never splits a word that does fit", () => {
    expect(textLines("abcdefghij kl", fs, width)).toEqual(["abcdefghij", "kl"]);
  });

  it("every produced line fits the character budget", () => {
    const lines = textLines("supercalifragilisticexpialidocious is a word", fs, width);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  });

  it("still honours explicit newlines while wrapping", () => {
    expect(textLines("one two three\nfour", fs, width)).toEqual(["one two", "three", "four"]);
  });
});

describe("textBoxPx", () => {
  it("sizes width from the longest line and height from the line count", () => {
    const fs = 10;
    const box = textBoxPx("ab\ncde", fs);
    expect(box.w).toBeCloseTo(3 * fs * 0.55); // "cde" is the longest line
    expect(box.h).toBeCloseTo(2 * fs * TEXT_LINE_HEIGHT); // two lines
  });

  it("a single line is one line tall", () => {
    const fs = 20;
    expect(textBoxPx("hi", fs).h).toBeCloseTo(fs * TEXT_LINE_HEIGHT);
  });
});

describe("textBoxPx, as the video overlay's box", () => {
  // The video overlay sized its selection rect from `text.length`, so a two-line label
  // reported a box twice as wide as it looked and only one line tall. This helper
  // already existed for the screenshot editor; these pin the properties the video
  // overlay now depends on.
  it("measures the longest line, not the whole string", () => {
    expect(textBoxPx("hello\nhi", 20).w).toBe(textBoxPx("hello", 20).w);
  });

  it("grows in height with each line", () => {
    expect(textBoxPx("a\nb\nc", 20).h).toBeCloseTo(textBoxPx("a", 20).h * 3);
  });

  it("keeps an empty trailing line, so a trailing Enter stays visible", () => {
    expect(textBoxPx("a\n", 20).h).toBeCloseTo(textBoxPx("a\nb", 20).h);
  });
});
