import { describe, expect, it, vi } from "vitest";
import {
  followRadiusSource,
  imageActionState,
  resetImageCrop,
  setImageRadius,
} from "./image-actions";
import { BASE_IMAGE_ID } from "./image-crop";
import type { ImageAnnotation } from "./scene";

const NATURAL = { w: 400, h: 200 };
const image: ImageAnnotation = {
  id: "i1",
  kind: "image",
  assetId: "img-aaaaaaaaaaaa",
  x: 0.5,
  y: 0.5,
  w: 0.2,
  h: 0.3,
  pixelWidth: 100,
  pixelHeight: 60,
};

describe("imageActionState", () => {
  it("is null for nothing, a non-image and a base without its asset size", () => {
    expect(imageActionState(null, [image], {}, NATURAL)).toBeNull();
    expect(imageActionState("nope", [image], {}, NATURAL)).toBeNull();
    expect(imageActionState(BASE_IMAGE_ID, [], {}, undefined)).toBeNull();
  });

  it("reads the base: crop, own radius and half the shorter visible side", () => {
    const plain = imageActionState(BASE_IMAGE_ID, [], {}, NATURAL)!;
    expect(plain).toEqual({ id: BASE_IMAGE_ID, hasCrop: false, maxRadius: 100 });
    const cropped = imageActionState(
      BASE_IMAGE_ID,
      [],
      { baseCrop: { x: 0, y: 0, w: 0.25, h: 1 }, baseRadius: 8 },
      NATURAL,
    )!;
    expect(cropped).toEqual({ id: BASE_IMAGE_ID, hasCrop: true, radius: 8, maxRadius: 50 });
  });

  it("reads an added image from its shown size", () => {
    expect(imageActionState("i1", [image], {}, NATURAL)).toEqual({
      id: "i1",
      hasCrop: false,
      maxRadius: 30,
    });
    const own = { ...image, radius: 5, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    expect(imageActionState("i1", [own], {}, NATURAL)).toEqual({
      id: "i1",
      hasCrop: true,
      radius: 5,
      maxRadius: 30, // its w and h are already the visible rect: the crop does not shrink it again
    });
  });
});

describe("imageActionState maxRadius follows the visible side in base source px", () => {
  it("an added image resized on the layer caps at half its shown side, not its asset's", () => {
    // The asset is 100x60 px but shows 0.5 x 0.4 of a 400x200 layer: 200 x 80 px.
    const grown = { ...image, w: 0.5, h: 0.4 };
    expect(imageActionState("i1", [grown], {}, NATURAL)!.maxRadius).toBe(40);
    // Shrunk below its asset: 0.05 x 0.2 of the layer is 20 x 40 px, so half of 20.
    const shrunk = { ...image, w: 0.05, h: 0.2 };
    expect(imageActionState("i1", [shrunk], {}, NATURAL)!.maxRadius).toBe(10);
  });

  it("a placed base caps at half its shown side, not its asset's", () => {
    // Shown at half scale: 200 x 100 px of the 400 x 200 asset.
    const half = imageActionState(
      BASE_IMAGE_ID,
      [],
      { basePlacement: { x: 0, y: 0, scale: 0.5 } },
      NATURAL,
    )!;
    expect(half.maxRadius).toBe(50);
    // Cropped to a quarter of the width and doubled: 0.25 * 2 * 400 = 200 wide, 1 * 2 * 200 = 400 tall.
    const both = imageActionState(
      BASE_IMAGE_ID,
      [],
      { baseCrop: { x: 0, y: 0, w: 0.25, h: 0.5 }, basePlacement: { x: 0, y: 0, scale: 2 } },
      NATURAL,
    )!;
    expect(both.maxRadius).toBe(100);
  });

  it("is null for an added image when the layer size is unknown", () => {
    expect(imageActionState("i1", [image], {}, undefined)).toBeNull();
  });
});

describe("followRadiusSource", () => {
  it("turns the slider's displayed px into source px", () => {
    // 4 displayed px on a shot shown at half its size is 8 source px.
    expect(followRadiusSource(4, 400, 200)).toBe(8);
  });
  it("is 0 without usable sizes", () => {
    expect(followRadiusSource(4, 0, 200)).toBe(0);
    expect(followRadiusSource(4, 400, 0)).toBe(0);
  });
});

describe("resetImageCrop", () => {
  const writer = (annotations: ImageAnnotation[]) => ({
    annotations,
    commitBase: vi.fn(),
    commitAnnotation: vi.fn(),
  });

  it("drops the base's crop in one commit", () => {
    const w = writer([]);
    resetImageCrop(w, { baseCrop: { x: 0, y: 0, w: 0.5, h: 0.5 } }, BASE_IMAGE_ID);
    expect(w.commitBase).toHaveBeenCalledTimes(1);
    expect(w.commitBase).toHaveBeenCalledWith({ baseCrop: undefined });
  });

  it("grows an added image back to its whole asset in one commit", () => {
    // Shows the right half (x 0.5..0.7); the whole asset is x 0.3..0.7.
    const cropped = { ...image, x: 0.5, w: 0.2, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const w = writer([cropped]);
    resetImageCrop(w, {}, "i1");
    expect(w.commitAnnotation).toHaveBeenCalledTimes(1);
    const [id, patch] = w.commitAnnotation.mock.calls[0]!;
    expect(id).toBe("i1");
    expect(patch.x).toBeCloseTo(0.3);
    expect(patch.w).toBeCloseTo(0.4);
    expect(patch.crop).toBeUndefined();
  });

  it("does nothing without a crop", () => {
    const w = writer([image]);
    resetImageCrop(w, {}, "i1");
    resetImageCrop(w, {}, BASE_IMAGE_ID);
    expect(w.commitAnnotation).not.toHaveBeenCalled();
    expect(w.commitBase).not.toHaveBeenCalled();
  });
});

describe("setImageRadius", () => {
  it("writes the base's radius through the base and an image's through its annotation", () => {
    const w = { commitBase: vi.fn(), commitAnnotation: vi.fn() };
    setImageRadius(w, BASE_IMAGE_ID, 12);
    expect(w.commitBase).toHaveBeenCalledWith({ baseRadius: 12 });
    setImageRadius(w, "i1", undefined);
    expect(w.commitAnnotation).toHaveBeenCalledWith("i1", { radius: undefined });
  });
});
