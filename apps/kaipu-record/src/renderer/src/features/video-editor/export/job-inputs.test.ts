import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, type ImageMediaItem, type VideoScene } from "../scene";
import type { SlideAsset, SlideAssetStore } from "../slide-assets";
import { buildExportPlan, sliceExportPlan } from "./export-plan";
import { prepareWorkerInputs } from "./job-inputs";

const asset = (assetId: string): SlideAsset => ({
  assetId,
  bytes: new ArrayBuffer(4),
  mimeType: "image/png",
  url: `blob:${assetId}`,
  naturalWidth: 1600,
  naturalHeight: 900,
});

const store = (...ids: string[]): SlideAssetStore =>
  ({ entries: () => ids.map(asset) }) as unknown as SlideAssetStore;

const img = (id: string, time: number, assetId = `asset-${id}`): ImageMediaItem => ({
  id,
  kind: "image",
  assetId,
  naturalWidth: 1600,
  naturalHeight: 900,
  anchor: { kind: "source", time },
  duration: 2,
  box: { x: 0.5, y: 0.5, width: 0.5 },
  z: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
});

const SCENE: VideoScene = {
  ...initialScene(1),
  items: [
    {
      id: "s1",
      kind: "slide",
      assetId: "slide-asset",
      duration: 2,
      naturalWidth: 8,
      naturalHeight: 6,
    },
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
  ],
  overlays: [],
};

let bitmaps: Array<{ tag: string }> = [];

beforeEach(() => {
  bitmaps = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      const bitmap = { tag: `bitmap-${bitmaps.length}` };
      bitmaps.push(bitmap);
      return bitmap;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const inputs = (scene: VideoScene, assets: SlideAssetStore, range?: [number, number]) => {
  const full = buildExportPlan(scene);
  const plan = range ? sliceExportPlan(full, range[0], range[1]) : full;
  return prepareWorkerInputs(
    {
      scene,
      videoWidth: 1920,
      videoHeight: 1080,
      previewWidth: 960,
      slideAssets: assets,
      cameraPath: null,
    },
    plan,
  );
};

describe("prepareWorkerInputs and floating images", () => {
  it("decodes the asset of a floating image that no slide uses, apart from the slides", async () => {
    const scene = { ...SCENE, media: [img("p", 1)] };
    const result = await inputs(scene, store("slide-asset", "asset-p", "asset-unused"));
    expect(result.slides.map((s) => s.assetId)).toEqual(["slide-asset"]);
    expect(result.mediaImages.map((m) => m.assetId)).toEqual(["asset-p"]);
    // Each bitmap travels once.
    expect(result.transfer.filter((t) => t === result.mediaImages[0].bitmap)).toHaveLength(1);
    expect(new Set(result.transfer).size).toBe(result.transfer.length);
  });

  it("does not decode the asset of an unplaced item", async () => {
    // Source 50 is in no clip: the anchor does not resolve.
    const scene = { ...SCENE, media: [img("gone", 50)] };
    const result = await inputs(scene, store("slide-asset", "asset-gone"));
    expect(result.mediaImages).toEqual([]);
  });

  it("gives a slide's asset its own bitmap when a floating image uses it too", async () => {
    const scene = { ...SCENE, media: [img("p", 1, "slide-asset")] };
    const result = await inputs(scene, store("slide-asset"));
    expect(result.slides).toHaveLength(1);
    expect(result.mediaImages).toHaveLength(1);
    expect(result.slides[0].bitmap).not.toBe(result.mediaImages[0].bitmap);
    expect(new Set(result.transfer).size).toBe(result.transfer.length);
  });

  it("a range that does not reach the item decodes nothing for it", async () => {
    // Timeline: slide 0-2, clip 2-12; the item sits at source 1 = timeline 3-5.
    const scene = { ...SCENE, media: [img("p", 1)] };
    expect((await inputs(scene, store("asset-p"), [6, 10])).mediaImages).toEqual([]);
    expect((await inputs(scene, store("asset-p"), [4, 10])).mediaImages).toHaveLength(1);
  });

  it("a scene without media decodes no floating image", async () => {
    const result = await inputs(SCENE, store("slide-asset", "asset-p"));
    expect(result.mediaImages).toEqual([]);
  });
});
