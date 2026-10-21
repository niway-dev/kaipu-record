import { describe, expect, it } from "vitest";
import type { NormRect } from "./redaction";
import { moveRect, resizeRect } from "./region-geometry";

const R = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };

function expectRect(actual: NormRect, expected: NormRect): void {
  for (const key of ["x", "y", "w", "h"] as const)
    expect(actual[key]).toBeCloseTo(expected[key], 9);
}

describe("moveRect", () => {
  it("moves and stays inside the frame", () => {
    expectRect(moveRect(R, 0.1, 0.1), { x: 0.3, y: 0.3, w: 0.4, h: 0.2 });
    expectRect(moveRect(R, 1, -1), { x: 0.6, y: 0, w: 0.4, h: 0.2 });
  });
});

describe("resizeRect", () => {
  it("keeps the opposite corner fixed", () => {
    expectRect(resizeRect(R, "se", { x: 0.8, y: 0.5 }), { x: 0.2, y: 0.2, w: 0.6, h: 0.3 });
    expectRect(resizeRect(R, "nw", { x: 0.1, y: 0.1 }), { x: 0.1, y: 0.1, w: 0.5, h: 0.3 });
  });
  it("never inverts or collapses", () => {
    expectRect(resizeRect(R, "se", { x: 0, y: 0 }), { x: 0.2, y: 0.2, w: 0.01, h: 0.01 });
  });
  it("clamps to the frame", () => {
    expectRect(resizeRect(R, "ne", { x: 2, y: -1 }), { x: 0.2, y: 0, w: 0.8, h: 0.4 });
  });
});
