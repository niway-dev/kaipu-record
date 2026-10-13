import { describe, expect, it } from "vitest";
import {
  addsBarsAt169,
  HEAVY_TO_SEND_BYTES,
  isHeavyToSend,
  percentLighter,
  SHARE_LIMIT_BYTES,
  sizeKindOf,
} from "./export-size";

describe("export size wording", () => {
  it("names the limits after the capped rows", () => {
    expect(SHARE_LIMIT_BYTES).toBe(10_000_000);
    expect(HEAVY_TO_SEND_BYTES).toBe(25_000_000);
    expect(isHeavyToSend(25_000_000)).toBe(false);
    expect(isHeavyToSend(25_000_001)).toBe(true);
  });

  it("says 'up to' only for the fixed canvases, and nothing for Maximum", () => {
    expect(sizeKindOf("balanced")).toBe("about");
    expect(sizeKindOf("small-10")).toBe("about");
    expect(sizeKindOf("small-25")).toBe("about");
    expect(sizeKindOf("youtube")).toBe("up-to");
    expect(sizeKindOf("vertical")).toBe("up-to");
    expect(sizeKindOf("square")).toBe("up-to");
    expect(sizeKindOf("maximum")).toBe("full");
  });

  it("computes percent lighter as 1 − estimate / original", () => {
    expect(percentLighter(9_200_000, 119_000_000)).toBe(92);
    expect(percentLighter(29_000_000, 119_000_000)).toBe(76);
  });

  it("has no percent without both sizes, or when the copy is not lighter", () => {
    expect(percentLighter(null, 119_000_000)).toBeNull();
    expect(percentLighter(9_000_000, null)).toBeNull();
    expect(percentLighter(9_000_000, 0)).toBeNull();
    expect(percentLighter(120_000_000, 119_000_000)).toBeNull();
  });

  it("knows when a 16:9 canvas adds bars", () => {
    expect(addsBarsAt169(1920, 1080)).toBe(false);
    expect(addsBarsAt169(2560, 1440)).toBe(false);
    expect(addsBarsAt169(1662, 1080)).toBe(true);
    expect(addsBarsAt169(0, 0)).toBe(false);
  });
});
