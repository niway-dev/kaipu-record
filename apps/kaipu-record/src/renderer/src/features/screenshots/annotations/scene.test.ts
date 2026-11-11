import { describe, expect, it } from "vitest";
import { FULL_CROP, sameScene, stepNumbers, type Annotation, type Scene } from "./scene";

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

describe("stepNumbers", () => {
  const step = (id: string): Annotation => ({
    id,
    kind: "step",
    x: 0.5,
    y: 0.5,
    color: "#fff",
    size: 1,
  });
  const box: Annotation = {
    id: "b",
    kind: "box",
    x: 0,
    y: 0,
    w: 0.1,
    h: 0.1,
    color: "#fff",
    stroke: 1,
    seed: 1,
  };

  it("numbers only the steps, 1-based, in array order, skipping other kinds", () => {
    const m = stepNumbers([step("s1"), box, step("s2"), step("s3")]);
    expect([...m]).toEqual([
      ["s1", 1],
      ["s2", 2],
      ["s3", 3],
    ]);
  });

  it("renumbers when a step in the middle is removed", () => {
    const m = stepNumbers([step("s1"), step("s3")]);
    expect([...m]).toEqual([
      ["s1", 1],
      ["s3", 2],
    ]);
  });
});
