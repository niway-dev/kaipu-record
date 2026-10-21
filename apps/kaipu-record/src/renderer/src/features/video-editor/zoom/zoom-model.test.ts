import { describe, expect, it } from "vitest";
import { isSoftZoom } from "./zoom-model";

describe("isSoftZoom", () => {
  it("flags windows shorter than 720 source px", () => {
    expect(isSoftZoom(1080, 1.5)).toBe(false);
    expect(isSoftZoom(1080, 1.6)).toBe(true);
    expect(isSoftZoom(2160, 3)).toBe(false);
    expect(isSoftZoom(0, 4)).toBe(false); // unknown size: no hint
  });
});
