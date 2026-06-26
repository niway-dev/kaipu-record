import { describe, expect, it } from "vitest";
import { levelsFromTimeDomain } from "./audio-levels";

const fill = (len: number, value: number): Uint8Array => new Uint8Array(len).fill(value);

describe("levelsFromTimeDomain", () => {
  it("returns one value per bar", () => {
    expect(levelsFromTimeDomain(fill(100, 128), 5)).toHaveLength(5);
  });

  it("is ~0 for silence (centered at 128)", () => {
    for (const v of levelsFromTimeDomain(fill(100, 128), 5)) {
      expect(v).toBeCloseTo(0, 5);
    }
  });

  it("clamps loud signal to 1", () => {
    for (const v of levelsFromTimeDomain(fill(100, 255), 5)) {
      expect(v).toBe(1);
    }
  });

  it("scales between 0 and 1", () => {
    for (const v of levelsFromTimeDomain(fill(100, 140), 5, 25)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
