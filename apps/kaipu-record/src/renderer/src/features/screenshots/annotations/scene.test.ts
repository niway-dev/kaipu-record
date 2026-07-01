import { describe, expect, it } from "vitest";
import { FULL_CROP, sameScene, type Scene } from "./scene";

const base: Scene = { beautify: {} as Scene["beautify"], annotations: [] };

describe("sameScene with crop", () => {
  it("is true when crop is the same reference (or both unset)", () => {
    expect(sameScene(base, base)).toBe(true);
  });
  it("is false when crop changes", () => {
    const cropped: Scene = { ...base, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } };
    expect(sameScene(base, cropped)).toBe(false);
    expect(sameScene(cropped, { ...cropped, crop: { ...cropped.crop! } })).toBe(false);
  });
  it("FULL_CROP is the whole image", () => {
    expect(FULL_CROP).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
