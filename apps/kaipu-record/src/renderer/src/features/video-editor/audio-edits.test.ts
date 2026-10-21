import { describe, expect, it } from "vitest";
import { isAudible, silencedSpansFor, type MutedRange } from "./audio-edits";

const range = (sourceStart: number, sourceEnd: number): MutedRange => ({
  id: `${sourceStart}-${sourceEnd}`,
  sourceStart,
  sourceEnd,
});

describe("isAudible", () => {
  it("is true where nothing is muted", () => {
    expect(isAudible(3, { audioMuted: false, mutedRanges: [] })).toBe(true);
  });

  it("is false everywhere once the whole video is muted", () => {
    expect(isAudible(3, { audioMuted: true, mutedRanges: [] })).toBe(false);
    expect(isAudible(0, { audioMuted: true, mutedRanges: [range(10, 15)] })).toBe(false);
  });

  it("is false inside a muted range and true outside it", () => {
    const scene = { audioMuted: false, mutedRanges: [range(10, 15)] };
    expect(isAudible(9.99, scene)).toBe(true);
    expect(isAudible(10, scene)).toBe(false);
    expect(isAudible(12, scene)).toBe(false);
    // The end is exclusive, so two touching ranges leave no audible sliver between.
    expect(isAudible(15, scene)).toBe(true);
  });

  it("treats overlapping ranges as one — zero added to zero is still zero", () => {
    const scene = { audioMuted: false, mutedRanges: [range(10, 15), range(12, 20)] };
    for (const t of [10, 12, 14, 19]) expect(isAudible(t, scene)).toBe(false);
    expect(isAudible(20, scene)).toBe(true);
  });
});

describe("silencedSpansFor", () => {
  it("returns nothing when the segment is untouched", () => {
    expect(silencedSpansFor(0, 5, { audioMuted: false, mutedRanges: [] })).toEqual([]);
  });

  it("silences the whole segment when the video is muted", () => {
    expect(silencedSpansFor(2, 6, { audioMuted: true, mutedRanges: [] })).toEqual([
      { start: 2, end: 6 },
    ]);
  });

  it("clips a range to the segment it falls in", () => {
    // The range starts before this segment and ends inside it.
    expect(silencedSpansFor(12, 20, { audioMuted: false, mutedRanges: [range(10, 15)] })).toEqual([
      { start: 12, end: 15 },
    ]);
  });

  it("drops a range that does not touch the segment", () => {
    expect(silencedSpansFor(20, 30, { audioMuted: false, mutedRanges: [range(10, 15)] })).toEqual(
      [],
    );
  });

  it("merges overlapping ranges into one span", () => {
    const spans = silencedSpansFor(0, 30, {
      audioMuted: false,
      mutedRanges: [range(10, 15), range(12, 20)],
    });
    expect(spans).toEqual([{ start: 10, end: 20 }]);
  });

  it("keeps separate ranges separate, in order", () => {
    const spans = silencedSpansFor(0, 30, {
      audioMuted: false,
      mutedRanges: [range(20, 25), range(5, 8)],
    });
    expect(spans).toEqual([
      { start: 5, end: 8 },
      { start: 20, end: 25 },
    ]);
  });
});
