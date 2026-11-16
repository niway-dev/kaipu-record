import { describe, expect, it } from "vitest";
import { EASING_PEAK_OVERSHOOT, EASING_PRESETS, easeValue, type EasingPreset } from "./easing";

const SAMPLES = 1000;
const sample = (easing: EasingPreset): number[] =>
  Array.from({ length: SAMPLES + 1 }, (_, i) => easeValue(easing, i / SAMPLES));

describe("easeValue", () => {
  it.each(EASING_PRESETS)("%s starts at exactly 0 and ends at exactly 1", (easing) => {
    expect(easeValue(easing, 0)).toBe(0);
    expect(easeValue(easing, 1)).toBe(1);
  });

  it.each(EASING_PRESETS)("%s holds its inputs to 0..1", (easing) => {
    expect(easeValue(easing, -3)).toBe(0);
    expect(easeValue(easing, 7)).toBe(1);
  });

  it.each(["ease-in-out", "linear", "ease-out"] as const)(
    "%s never decreases or exceeds 1",
    (e) => {
      const values = sample(e);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
      }
      expect(Math.max(...values)).toBeLessThanOrEqual(1);
    },
  );

  it("linear is the identity and ease-in-out is symmetric at the middle", () => {
    expect(easeValue("linear", 0.25)).toBeCloseTo(0.25);
    expect(easeValue("ease-in-out", 0.5)).toBeCloseTo(0.5);
  });

  it("back passes 1 once, then settles on 1", () => {
    const values = sample("back");
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(values[SAMPLES]).toBe(1);
  });
});

describe("EASING_PEAK_OVERSHOOT", () => {
  it("is 0 for the presets that never pass 1", () => {
    expect(EASING_PEAK_OVERSHOOT["ease-in-out"]).toBe(0);
    expect(EASING_PEAK_OVERSHOOT.linear).toBe(0);
    expect(EASING_PEAK_OVERSHOOT["ease-out"]).toBe(0);
  });

  it("matches the sampled maximum of back", () => {
    const peak = Math.max(...sample("back")) - 1;
    expect(EASING_PEAK_OVERSHOOT.back).toBeCloseTo(peak, 3);
    expect(Math.abs(EASING_PEAK_OVERSHOOT.back - peak)).toBeLessThan(1e-3);
  });
});
