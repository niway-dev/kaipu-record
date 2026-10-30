import { describe, expect, it } from "vitest";
import {
  addsBarsAt169,
  exportEtaSeconds,
  HEAVY_TO_SEND_BYTES,
  isHeavyToSend,
  percentLighter,
  SHARE_LIMIT_BYTES,
  sizeKindOf,
} from "./export-size";

describe("export size wording", () => {
  it("offers a light copy over 10 MB and calls a file heavy over 25 MB", () => {
    expect(SHARE_LIMIT_BYTES).toBe(10_000_000);
    expect(HEAVY_TO_SEND_BYTES).toBe(25_000_000);
    expect(isHeavyToSend(25_000_000)).toBe(false);
    expect(isHeavyToSend(25_000_001)).toBe(true);
  });

  it("says 'up to' only for the fixed canvases, and nothing for Maximum", () => {
    expect(sizeKindOf("balanced")).toBe("about");
    expect(sizeKindOf("light")).toBe("about");
    expect(sizeKindOf("youtube-1440")).toBe("up-to");
    expect(sizeKindOf("youtube-4k")).toBe("up-to");
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

describe("exportEtaSeconds", () => {
  it("waits for a few percent and a couple of seconds before guessing", () => {
    expect(exportEtaSeconds(0.02, 10_000)).toBeNull();
    expect(exportEtaSeconds(0.5, 1000)).toBeNull();
    expect(exportEtaSeconds(1, 10_000)).toBeNull();
  });

  it("projects the rate so far, in 5 s steps under a minute and whole minutes above", () => {
    // 64 % in 36 s → 20.25 s left → "about 25 s".
    expect(exportEtaSeconds(0.64, 36_000)).toBe(25);
    expect(exportEtaSeconds(0.99, 10_000)).toBe(5);
    // 10 % in 20 s → 180 s left.
    expect(exportEtaSeconds(0.1, 20_000)).toBe(180);
  });
});
