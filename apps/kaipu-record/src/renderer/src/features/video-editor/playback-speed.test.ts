import { describe, expect, it } from "vitest";
import { DEFAULT_SPEED, formatSpeed, nextSpeed, PREVIEW_SPEEDS } from "./playback-speed";

describe("preview playback speed", () => {
  it("offers 0.5x, 1x, 1.5x and 2x, and starts at 1x", () => {
    expect([...PREVIEW_SPEEDS]).toEqual([0.5, 1, 1.5, 2]);
    expect(DEFAULT_SPEED).toBe(1);
  });

  it("cycles 1x -> 1.5x -> 2x -> 0.5x -> 1x", () => {
    expect(nextSpeed(1)).toBe(1.5);
    expect(nextSpeed(1.5)).toBe(2);
    expect(nextSpeed(2)).toBe(0.5);
    expect(nextSpeed(0.5)).toBe(1);
  });

  it("falls back to the step after 1x for a value outside the list", () => {
    expect(nextSpeed(3)).toBe(1.5);
  });
});

describe("formatSpeed", () => {
  it.each([
    ["en", 0.5, "0.5"],
    ["en", 1, "1"],
    ["en", 1.5, "1.5"],
    ["en", 2, "2"],
    ["es", 0.5, "0,5"],
    ["es", 1, "1"],
    ["es", 1.5, "1,5"],
    ["es", 2, "2"],
  ])("writes %s %s as %s", (locale, speed, expected) => {
    expect(formatSpeed(speed, locale)).toBe(expected);
  });
});
