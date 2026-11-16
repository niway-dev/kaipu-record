import { describe, expect, it } from "vitest";
import { silenceChunkFrames } from "./silence-chunks";

describe("silenceChunkFrames", () => {
  it("adds up to the frames a single allocation would have held", () => {
    for (const seconds of [0.01, 0.5, 1, 1.0001, 2.5, 90.25]) {
      const total = silenceChunkFrames(seconds, 48000).reduce((a, b) => a + b, 0);
      expect(total).toBe(Math.ceil(seconds * 48000));
    }
  });

  it("never allocates more than one second at once, even for a 30-minute clip", () => {
    const chunks = silenceChunkFrames(30 * 60, 48000);
    expect(Math.max(...chunks)).toBe(48000);
    expect(chunks).toHaveLength(1800);
  });

  it("is empty for no duration", () => {
    expect(silenceChunkFrames(0, 48000)).toEqual([]);
    expect(silenceChunkFrames(Number.NaN, 48000)).toEqual([]);
  });
});
