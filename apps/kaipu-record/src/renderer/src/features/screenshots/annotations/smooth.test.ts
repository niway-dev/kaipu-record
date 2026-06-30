import { describe, expect, it } from "vitest";
import { smoothPath } from "./smooth";

describe("smoothPath", () => {
  it("returns empty for no points", () => {
    expect(smoothPath([])).toBe("");
  });

  it("draws a tiny segment (a dot) for a single point", () => {
    expect(smoothPath([{ x: 5, y: 5 }])).toBe("M 5 5 L 5.01 5");
  });

  it("draws a straight line for two points", () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 4 }])).toBe("M 0 0 L 10 4");
  });

  it("emits cubic Béziers for 3+ points and never NaN", () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 5, y: 8 }, { x: 12, y: 3 }, { x: 18, y: 9 }]);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain(" C ");
    expect(d).not.toContain("NaN");
  });
});
