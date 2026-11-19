import { describe, expect, it } from "vitest";
import { downmixToMono, floatToInt16, Resampler } from "./pcm-convert";

const TARGET_RATE = 16000;

function sine(
  frames: number,
  freq: number,
  rate: number,
  amplitude = 0.5,
  offset = 0,
): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * (i + offset)) / rate);
  }
  return out;
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (to - from));
}

/** Rising zero crossings in a window: one per period of a clean tone. */
function risingCrossings(samples: Float32Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1]! < 0 && samples[i]! >= 0) count++;
  return count;
}

function resampleAll(input: Float32Array, rate: number): Float32Array {
  const resampler = new Resampler(rate);
  return concat([resampler.push(input), resampler.flush()]);
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("downmixToMono", () => {
  it("averages the channels sample by sample", () => {
    const left = Float32Array.of(1, 0.5, -1);
    const right = Float32Array.of(0, 0.5, 1);
    expect(Array.from(downmixToMono([left, right]))).toEqual([0.5, 0.5, 0]);
  });

  it("returns a single channel unchanged", () => {
    const only = Float32Array.of(0.25, -0.5);
    expect(Array.from(downmixToMono([only]))).toEqual([0.25, -0.5]);
  });

  it("returns an empty array when there are no channels", () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});

describe("floatToInt16", () => {
  it("scales, rounds and clamps at full scale", () => {
    const converted = floatToInt16(Float32Array.of(0, 0.5, 1, -1, 2, -2, 1e9, -1e9));
    expect(Array.from(converted)).toEqual([0, 16384, 32767, -32767, 32767, -32767, 32767, -32767]);
  });

  it("maps NaN to silence", () => {
    expect(Array.from(floatToInt16(Float32Array.of(Number.NaN)))).toEqual([0]);
  });
});

describe("Resampler", () => {
  it.each([48000, 44100])("keeps the frequency and amplitude of a 1 kHz tone at %i Hz", (rate) => {
    const out = resampleAll(sine(rate, 1000, rate), rate);
    // Skip the filter's edge transient; the middle 0.8 s is steady state.
    const from = Math.round(TARGET_RATE * 0.1);
    const to = Math.round(TARGET_RATE * 0.9);
    const periods = risingCrossings(out, from, to);
    expect(Math.abs(periods - 800)).toBeLessThanOrEqual(1);
    expect(rms(out, from, to)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("passes a 6 kHz tone near the top of the speech band with its level intact", () => {
    const out = resampleAll(sine(48000, 6000, 48000), 48000);
    expect(rms(out, 1600, 14400)).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it("attenuates a 12 kHz tone at 48 kHz instead of aliasing it down to 4 kHz", () => {
    const out = resampleAll(sine(48000, 12000, 48000), 48000);
    const input = 0.5 / Math.SQRT2;
    expect(rms(out, 1600, 14400)).toBeLessThan(input * 0.003);
  });

  it("attenuates a 12 kHz tone at 44.1 kHz", () => {
    const out = resampleAll(sine(44100, 12000, 44100), 44100);
    expect(rms(out, 1600, 14000)).toBeLessThan((0.5 / Math.SQRT2) * 0.003);
  });

  it("gives the same samples whether the input arrives in one push or in odd-sized chunks", () => {
    const input = sine(100_000, 700, 44100);
    const whole = resampleAll(input, 44100);
    const resampler = new Resampler(44100);
    const parts: Float32Array[] = [];
    const sizes = [1, 7, 4096, 33, 1500, 9, 12345];
    let at = 0;
    for (let i = 0; at < input.length; i++) {
      const size = sizes[i % sizes.length]!;
      parts.push(resampler.push(input.subarray(at, at + size)));
      at += size;
    }
    parts.push(resampler.flush());
    expect(concat(parts)).toEqual(whole);
  });

  it.each([
    [48000, 48000],
    [48000, 12345],
    [44100, 44100],
    [44100, 1],
    [44100, 100_003],
    [8000, 8000],
    [22050, 5],
    [96000, 17],
    [16000, 9999],
  ])("outputs round(n * 16000 / rate) samples for %i Hz and %i frames", (rate, frames) => {
    const out = resampleAll(new Float32Array(frames), rate);
    expect(Math.abs(out.length - Math.round((frames * TARGET_RATE) / rate))).toBeLessThanOrEqual(1);
    expect(out.length).toBe(Math.round((frames * TARGET_RATE) / rate));
  });

  it("returns nothing for empty input", () => {
    const resampler = new Resampler(48000);
    expect(resampler.push(new Float32Array(0)).length).toBe(0);
    expect(resampler.flush().length).toBe(0);
  });

  it("copies 16 kHz input through untouched", () => {
    const input = sine(5000, 440, 16000);
    const resampler = new Resampler(16000);
    const out = concat([resampler.push(input), resampler.flush()]);
    expect(out).toEqual(input);
    expect(out.buffer).not.toBe(input.buffer);
  });

  it("upsamples 8 kHz input and keeps the tone", () => {
    const out = resampleAll(sine(8000, 500, 8000), 8000);
    expect(out.length).toBe(16000);
    expect(Math.abs(risingCrossings(out, 1600, 14400) - 400)).toBeLessThanOrEqual(1);
    expect(rms(out, 1600, 14400)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("can be reused after a flush and starts from a clean state", () => {
    const resampler = new Resampler(48000);
    const input = sine(9600, 1000, 48000);
    const first = concat([resampler.push(input), resampler.flush()]);
    const second = concat([resampler.push(input), resampler.flush()]);
    expect(second).toEqual(first);
  });

  it("does not click at a seam: the output stays within the tone's envelope", () => {
    const resampler = new Resampler(48000);
    const input = sine(48000, 1000, 48000);
    const out = concat([
      resampler.push(input.subarray(0, 20001)),
      resampler.push(input.subarray(20001)),
      resampler.flush(),
    ]);
    let maxStep = 0;
    for (let i = 1; i < out.length; i++)
      maxStep = Math.max(maxStep, Math.abs(out[i]! - out[i - 1]!));
    // A 1 kHz tone of amplitude 0.5 sampled at 16 kHz steps by at most 0.5 * 2 * sin(pi/16).
    expect(maxStep).toBeLessThan(0.2);
  });

  it("rejects a non-positive or fractional sample rate", () => {
    expect(() => new Resampler(0)).toThrow();
    expect(() => new Resampler(44100.5)).toThrow();
  });

  it("resamples 10 minutes of 48 kHz audio in bounded time with the right length and level", () => {
    const rate = 48000;
    const resampler = new Resampler(rate);
    const second = sine(rate, 1000, rate);
    let total = 0;
    let energy = 0;
    const started = performance.now();
    for (let s = 0; s < 600; s++) {
      const out = resampler.push(second);
      total += out.length;
      if (s >= 1 && s < 599) energy += rms(out) ** 2;
    }
    total += resampler.flush().length;
    const elapsedMs = performance.now() - started;

    expect(total).toBe(600 * TARGET_RATE);
    expect(Math.sqrt(energy / 598)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(elapsedMs).toBeLessThan(15_000);
  });
});
