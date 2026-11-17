import { describe, expect, it } from "vitest";
import {
  FULL_CROP,
  nextAnnotationId,
  reserveAnnotationIds,
  sameScene,
  baseFullRect,
  baseVisibleRect,
  fullRect,
  stepNumbers,
  type Annotation,
  type Scene,
} from "./scene";

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

describe("reserveAnnotationIds", () => {
  it("skips an id too large for a safe integer, so new ids stay finite", () => {
    const box = (id: string): Annotation => ({ id, kind: "blur", x: 0, y: 0, w: 1, h: 1 });
    reserveAnnotationIds([box(`a${"9".repeat(310)}`)]);
    expect(nextAnnotationId().id).not.toBe("aInfinity");
  });
  it("moves the counter past ids already present in a reopened document", () => {
    const box = (id: string): Annotation => ({ id, kind: "blur", x: 0, y: 0, w: 1, h: 1 });
    reserveAnnotationIds([box("a41"), box("a7"), box("custom"), box("image-base")]);
    const next = nextAnnotationId();
    expect(Number(next.id.slice(1))).toBeGreaterThanOrEqual(42);
    // Never moves backwards.
    reserveAnnotationIds([box("a3")]);
    expect(Number(nextAnnotationId().id.slice(1))).toBeGreaterThan(Number(next.id.slice(1)));
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

describe("fullRect", () => {
  // Illustrative: a visible rect of 0.25 x 0.25 at (1, 0.5) that shows the middle half of
  // its asset on both axes, so the whole asset is twice as large and starts 0.125 earlier.
  const image = {
    id: "i",
    kind: "image" as const,
    assetId: "img-aaaaaaaaaaaa",
    x: 1,
    y: 0.5,
    w: 0.25,
    h: 0.25,
    pixelWidth: 100,
    pixelHeight: 100,
  };

  it("is the visible rect when there is no crop", () => {
    expect(fullRect(image)).toEqual({ x: 1, y: 0.5, w: 0.25, h: 0.25 });
  });

  it("is the visible rect when the crop is the whole asset", () => {
    expect(fullRect({ ...image, crop: { x: 0, y: 0, w: 1, h: 1 } })).toEqual({
      x: 1,
      y: 0.5,
      w: 0.25,
      h: 0.25,
    });
  });

  it("extends the visible rect to the asset's own rect", () => {
    expect(fullRect({ ...image, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })).toEqual({
      x: 0.875,
      y: 0.375,
      w: 0.5,
      h: 0.5,
    });
  });

  it("throws for a crop that is not a window, instead of guessing the visible rect", () => {
    for (const crop of [
      { x: 0, y: 0, w: 0, h: 1 },
      { x: 0, y: 0, w: 1, h: -1 },
      { x: Number.NaN, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 1 },
    ]) {
      expect(() => fullRect({ ...image, crop })).toThrow(RangeError);
    }
  });
});

describe("the base's rects (per-image crop, unit 3)", () => {
  it("is the unit rect without a placement, whatever the crop says", () => {
    expect(baseFullRect({})).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // The whole-asset rect never reads the crop: baking a redaction relies on it.
    expect(baseFullRect({ baseCrop: { x: 0.5, y: 0, w: 0.5, h: 1 } } as never)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
  it("a placement moves and scales the whole asset uniformly", () => {
    expect(baseFullRect({ basePlacement: { x: 1, y: 0.25, scale: 0.5 } })).toEqual({
      x: 1,
      y: 0.25,
      w: 0.5,
      h: 0.5,
    });
  });
  it("the visible rect is the crop window of the whole rect", () => {
    expect(baseVisibleRect({})).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(
      baseVisibleRect({
        basePlacement: { x: 1, y: 0.25, scale: 0.5 },
        baseCrop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      }),
    ).toEqual({ x: 1.125, y: 0.375, w: 0.25, h: 0.25 });
  });
  it("an invalid placement throws instead of guessing where the asset is", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => baseFullRect({ basePlacement: { x: 0, y: 0, scale } })).toThrow(RangeError);
    }
    expect(() => baseFullRect({ basePlacement: { x: Number.NaN, y: 0, scale: 1 } })).toThrow(
      RangeError,
    );
  });
  it("an invalid base crop throws instead of giving a NaN or empty rect", () => {
    for (const baseCrop of [
      { x: 0, y: 0, w: 0, h: 1 },
      { x: 0, y: 0, w: -1, h: 1 },
      { x: Number.NaN, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 1 },
    ]) {
      expect(() => baseVisibleRect({ baseCrop }), JSON.stringify(baseCrop)).toThrow(RangeError);
    }
  });
  it("sameScene sees a change of any base field", () => {
    const s: Scene = { ...base };
    expect(sameScene(s, { ...s, baseCrop: { x: 0, y: 0, w: 1, h: 1 } })).toBe(false);
    expect(sameScene(s, { ...s, baseRadius: 4 })).toBe(false);
    expect(sameScene(s, { ...s, basePlacement: { x: 0, y: 0, scale: 1 } })).toBe(false);
  });
});
