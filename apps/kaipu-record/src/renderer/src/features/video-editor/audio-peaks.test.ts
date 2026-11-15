import { describe, expect, it } from "vitest";
import {
  PEAK_BUCKETS_PER_SECOND,
  PeakAccumulator,
  levelToHeight,
  referenceLevel,
} from "./audio-peaks";

describe("PeakAccumulator", () => {
  it("allocates 100 buckets per second, rounded up", () => {
    expect(PEAK_BUCKETS_PER_SECOND).toBe(100);
    const acc = new PeakAccumulator(2.505);
    expect(acc.peaks).toHaveLength(251);
    expect(acc.filled).toBe(0);
  });

  it("keeps the largest absolute sample of each bucket, across channels", () => {
    // 100 Hz sample rate: one sample per bucket.
    const acc = new PeakAccumulator(1);
    acc.add(0, 100, [Float32Array.of(0.1, -0.5, 0.2), Float32Array.of(-0.3, 0.1, 0.9)]);
    expect(acc.peaks[0]).toBeCloseTo(0.3);
    expect(acc.peaks[1]).toBeCloseTo(0.5);
    expect(acc.peaks[2]).toBeCloseTo(0.9);
    expect(acc.filled).toBe(3);
  });

  it("merges several samples into one bucket and offsets by the timestamp", () => {
    const acc = new PeakAccumulator(1);
    // 1000 Hz: 10 samples per bucket; starting at 0.2 s = bucket 20.
    const plane = new Float32Array(20);
    plane[3] = 0.4;
    plane[7] = -0.6;
    plane[12] = 0.25;
    acc.add(0.2, 1000, [plane]);
    expect(acc.peaks[20]).toBeCloseTo(0.6);
    expect(acc.peaks[21]).toBeCloseTo(0.25);
    expect(acc.filled).toBe(22);
  });

  it("ignores indices outside the allocated range", () => {
    const acc = new PeakAccumulator(1);
    acc.add(-0.01, 100, [Float32Array.of(0.9, 0.8, 0.7)]); // first falls before 0
    acc.add(0.99, 100, [Float32Array.of(0.5, 0.6)]); // second falls past the end
    expect(acc.peaks[0]).toBeCloseTo(0.8);
    expect(acc.peaks[1]).toBeCloseTo(0.7);
    expect(acc.peaks[99]).toBeCloseTo(0.5);
    expect(acc.filled).toBe(100);
  });
});

describe("referenceLevel", () => {
  it("is 0 when everything is silent", () => {
    expect(referenceLevel(new Float32Array(10), 10)).toBe(0);
  });

  it("ignores one loud click: the 99th percentile of the non-zero peaks", () => {
    const peaks = new Float32Array(1000).fill(0.2);
    peaks[500] = 1;
    expect(referenceLevel(peaks, 1000)).toBeCloseTo(0.2);
  });

  it("only looks at the filled part and skips zeros", () => {
    const peaks = new Float32Array(10);
    peaks[0] = 0.4;
    peaks[1] = 0;
    peaks[9] = 1; // not filled yet
    expect(referenceLevel(peaks, 5)).toBeCloseTo(0.4);
  });

  it("falls back to the max for a handful of values", () => {
    expect(referenceLevel(Float32Array.of(0.1, 0.8, 0.3), 3)).toBeCloseTo(0.8);
  });

  it("samples a long take evenly instead of sorting every bucket", () => {
    const peaks = new Float32Array(500_000).fill(0.3);
    expect(referenceLevel(peaks, peaks.length)).toBeCloseTo(0.3);
  });
});

describe("levelToHeight", () => {
  it("maps the reference to 1 and -48 dB to 0", () => {
    expect(levelToHeight(0.5, 0.5)).toBeCloseTo(1);
    expect(levelToHeight(0.5 * 10 ** (-48 / 20), 0.5)).toBeCloseTo(0);
    expect(levelToHeight(0.5 * 10 ** (-24 / 20), 0.5)).toBeCloseTo(0.5);
  });

  it("clamps louder than the reference to 1 and quieter than -48 dB to 0", () => {
    expect(levelToHeight(1, 0.25)).toBe(1);
    expect(levelToHeight(0.0001, 0.5)).toBe(0);
  });

  it("is 0 for silence or an all-silent take", () => {
    expect(levelToHeight(0, 0.5)).toBe(0);
    expect(levelToHeight(0.3, 0)).toBe(0);
  });
});
