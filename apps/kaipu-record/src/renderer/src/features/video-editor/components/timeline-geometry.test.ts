import { describe, expect, it } from "vitest";
import {
  fractionToTime,
  rulerTicks,
  thumbnailsForRange,
  thumbnailsForRangeWithin,
  timeToFraction,
} from "./timeline-geometry";

describe("time/fraction mapping", () => {
  it("maps and clamps", () => {
    expect(timeToFraction(5, 10)).toBe(0.5);
    expect(timeToFraction(-1, 10)).toBe(0);
    expect(timeToFraction(15, 10)).toBe(1);
    expect(timeToFraction(0, 0)).toBe(0); // zero-duration guard
    expect(fractionToTime(0.25, 60)).toBe(15);
  });
});

describe("rulerTicks", () => {
  it("picks a nice interval and includes 0", () => {
    const ticks = rulerTicks(90);
    expect(ticks[0]).toEqual({ time: 0, label: "0:00" });
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks.length).toBeLessThanOrEqual(11);
    expect(ticks.at(-1)!.time).toBeLessThanOrEqual(90);
  });

  it.each([10.5, 15, 101])(
    "keeps a reasonable tick count for short/edge durations (%s)",
    (duration) => {
      const ticks = rulerTicks(duration);
      expect(ticks.length).toBeGreaterThanOrEqual(5);
      expect(ticks.length).toBeLessThanOrEqual(11);
    },
  );
});

describe("thumbnailsForRange", () => {
  const thumbs = Array.from({ length: 10 }, (_, i) => ({
    sourceTime: i * 10 + 5, // 5, 15, ... 95
    url: `u${i}`,
  }));

  it("picks nearest thumbnails evenly across the source range", () => {
    const picked = thumbnailsForRange(thumbs, 20, 60, 4);
    expect(picked).toHaveLength(4);
    expect(picked[0].sourceTime).toBeGreaterThanOrEqual(15);
    expect(picked.at(-1)!.sourceTime).toBeLessThanOrEqual(65);
  });

  it("returns [] when there are no thumbnails", () => {
    expect(thumbnailsForRange([], 0, 10, 4)).toEqual([]);
  });
});

describe("thumbnailsForRangeWithin", () => {
  // A webcam that only has frames between source 20 s and 50 s, one thumbnail every 10 s.
  const thumbs = [25, 35, 45].map((sourceTime, i) => ({ sourceTime, url: `c${i}` }));

  it("leaves a tile empty where the nearest frame is farther than the gap", () => {
    // Targets 5, 15, 25, ... 95: with a 6 s gap only 25, 35 and 45 have a frame.
    const picked = thumbnailsForRangeWithin(thumbs, 0, 100, 10, 6);
    expect(picked.map((t) => t?.url ?? null)).toEqual([
      null,
      null,
      "c0",
      "c1",
      "c2",
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("returns [] when there are no thumbnails", () => {
    expect(thumbnailsForRangeWithin([], 0, 10, 4, 1)).toEqual([]);
  });
});
