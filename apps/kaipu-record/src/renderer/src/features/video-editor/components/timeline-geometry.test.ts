import { describe, expect, it } from "vitest";
import {
  fractionToTime,
  rulerTicks,
  thumbnailsForRange,
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
