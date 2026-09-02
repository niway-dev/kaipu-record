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
