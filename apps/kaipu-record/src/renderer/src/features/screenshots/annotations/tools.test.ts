import { describe, expect, it } from "vitest";

import { TEXT_LINE_HEIGHT, textBoxPx, textLines, wrapText } from "./tools";

describe("textLines", () => {
  it("returns a single line when there is no break", () => {
    expect(textLines("hello")).toEqual(["hello"]);
  });

  it("splits on every newline, keeping empty lines", () => {
    expect(textLines("a\nb\n\nc")).toEqual(["a", "b", "", "c"]);
  });
});

describe("wrapText", () => {
  // fs 10 → char advance 5.5px → width 55px ≈ 10 chars per line.
  const fs = 10;
  const width = 55;

  it("without a width, breaks only on explicit newlines", () => {
    expect(wrapText("one two three four", fs)).toEqual(["one two three four"]);
    expect(wrapText("a\nb", fs)).toEqual(["a", "b"]);
  });

  it("word-wraps to the width, whole words only", () => {
    expect(wrapText("one two three four", fs, width)).toEqual(["one two", "three four"]);
  });

  it("a word wider than the box overflows on its own line (never split mid-letter)", () => {
    expect(wrapText("abcdefghijklmno pq", fs, width)).toEqual(["abcdefghijklmno", "pq"]);
  });

  it("still honours explicit newlines while wrapping", () => {
    expect(wrapText("one two three\nfour", fs, width)).toEqual(["one two", "three", "four"]);
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
