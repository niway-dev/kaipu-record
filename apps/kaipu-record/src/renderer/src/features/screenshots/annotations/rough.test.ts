import { describe, expect, it } from "vitest";
import { roughArrow, roughRect } from "./rough";

describe("rough", () => {
  it("roughRect is deterministic per seed and emits a closed path", () => {
    const a = roughRect(100, 50, 10, 11);
    expect(roughRect(100, 50, 10, 11)).toBe(a);
    expect(a.startsWith("M ")).toBe(true);
    expect(a.trimEnd().endsWith("Z")).toBe(true);
  });

  it("roughRect changes with the seed (the jitter)", () => {
    expect(roughRect(100, 50, 10, 11)).not.toBe(roughRect(100, 50, 10, 31));
  });

  it("roughArrow is deterministic per seed and draws a head", () => {
    const a = roughArrow(0, 0, 100, 60, 5);
    expect(roughArrow(0, 0, 100, 60, 5)).toBe(a);
    // body 'Q' + the two head segments 'L'
    expect(a).toContain("Q");
    expect((a.match(/L /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
