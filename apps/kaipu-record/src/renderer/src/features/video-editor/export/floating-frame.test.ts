import { describe, expect, it } from "vitest";
import { mediaAt, mediaBoxPx } from "../media";
import { initialScene, type ImageMediaItem, type TrackItem, type VideoScene } from "../scene";
import { toLayout } from "../timeline";
import { buildExportPlan, sliceExportPlan } from "./export-plan";
import { floatingAssetIds, floatingFrame, floatingLiveAt } from "./floating-frame";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});
const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `slide-asset-${id}`,
  duration,
  naturalWidth: 800,
  naturalHeight: 600,
});

/** A floating image anchored to the recording at `time`. */
const img = (
  id: string,
  time: number,
  duration: number,
  z: number,
  extra: Partial<ImageMediaItem> = {},
): ImageMediaItem => ({
  id,
  kind: "image",
  assetId: `asset-${id}`,
  naturalWidth: 1600,
  naturalHeight: 900,
  anchor: { kind: "source", time },
  duration,
  box: { x: 0.5, y: 0.5, width: 0.5 },
  z,
  fadeInMs: 0,
  fadeOutMs: 0,
  ...extra,
});

const PICTURE = { width: 1920, height: 1080 };

function scene(media?: ImageMediaItem[]): VideoScene {
  return {
    ...initialScene(1),
    // Timeline: slide 0-3, clip a (source 0-10) 3-13, clip b (source 20-25) 13-18.
    items: [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)],
    overlays: [],
    ...(media ? { media } : {}),
  };
}

describe("the plan carries the floating images", () => {
  it("has no floating key for a scene without media, so its plan is what it always was", () => {
    expect("floating" in buildExportPlan(scene())).toBe(false);
    expect("floating" in buildExportPlan(scene([]))).toBe(false);
  });

  it("includes the asset ids of placed items, even when no slide uses them", () => {
    const plan = buildExportPlan(scene([img("p", 2, 4, 0), img("q", 21, 2, 1)]));
    expect([...floatingAssetIds(plan.floating)].sort()).toEqual(["asset-p", "asset-q"]);
    // Neither is a slide asset: the runners decode them from `floating`, not from slides.
    expect(plan.segments.filter((s) => s.kind === "slide").map((s) => s.assetId)).toEqual([
      "slide-asset-s1",
    ]);
  });

  it("leaves out an item whose footage was deleted (it does not resolve)", () => {
    // Source 12-15 is not in any kept clip: the anchor does not resolve.
    const plan = buildExportPlan(scene([img("kept", 2, 4, 0), img("gone", 12, 2, 1)]));
    expect([...floatingAssetIds(plan.floating)]).toEqual(["asset-kept"]);
    const onlyGone = buildExportPlan(scene([img("gone", 12, 2, 0)]));
    expect(onlyGone.floating).toBeUndefined();
  });

  it("is plain data the worker can structured-clone", () => {
    const plan = buildExportPlan(scene([img("p", 2, 4, 0)]));
    expect(structuredClone(plan.floating)).toEqual(plan.floating);
  });
});

describe("floatingFrame is mediaAt", () => {
  const media = [
    img("back", 1, 8, 0, { fadeInMs: 500, fadeOutMs: 500 }),
    img("front", 4, 3, 5, { box: { x: 0.25, y: 0.75, width: 0.3 }, fadeInMs: 200 }),
    img("mid", 5, 2, 2),
    img("late", 21, 2, 1),
  ];
  const full = scene(media);
  const plan = buildExportPlan(full);
  const layout = toLayout(full.items);

  it("returns the same items, opacity and order as mediaAt, with mediaBoxPx rects", () => {
    for (let t = 0; t <= 18; t += 0.125) {
      const expected = mediaAt(full, layout, t);
      const got = floatingFrame(plan.floating, t, PICTURE);
      expect(got.map((d) => [d.item.id, d.opacity])).toEqual(
        expected.map((v) => [v.item.id, v.opacity]),
      );
      expect(got.map((d) => d.rect)).toEqual(expected.map((v) => mediaBoxPx(v.item, PICTURE)));
    }
  });

  it("draws back to front: lower z first", () => {
    // Timeline: back 4-12, front 7-10, mid 8-10 (a source time in clip a lands at 3 + time).
    const ids = floatingFrame(plan.floating, 8.5, PICTURE).map((d) => d.item.id);
    expect(ids).toEqual(["back", "mid", "front"]);
  });

  it("sees an item at its real time, and not before or after", () => {
    expect(floatingFrame(plan.floating, 3.5, PICTURE)).toEqual([]);
    // 0.25 s into back's 0.5 s fade-in.
    const fading = floatingFrame(plan.floating, 4.25, PICTURE);
    expect(fading.map((d) => [d.item.id, d.opacity])).toEqual([["back", 0.5]]);
    expect(floatingFrame(plan.floating, 12.5, PICTURE)).toEqual([]);
  });

  it("draws nothing without a floating plan", () => {
    expect(floatingFrame(undefined, 5, PICTURE)).toEqual([]);
    expect(floatingFrame(null, 5, PICTURE)).toEqual([]);
  });

  it("a sliced (GIF range) plan shows the same items at the same moments, on its own clock", () => {
    const from = 4;
    const sliced = sliceExportPlan(plan, from, 15);
    for (let local = 0; local < 11; local += 0.25) {
      const expected = mediaAt(full, layout, local + from);
      const got = floatingFrame(sliced.floating, local, PICTURE);
      expect(got.map((d) => [d.item.id, d.opacity])).toEqual(
        expected.map((v) => [v.item.id, v.opacity]),
      );
    }
  });

  it("a sliced plan keeps only the items on screen inside the range", () => {
    // Back ends at 12 and late starts at 14: nothing is on screen in 12-13.9.
    expect(sliceExportPlan(plan, 12, 13.9).floating).toBeUndefined();
    const ids = [...floatingAssetIds(sliceExportPlan(plan, 13.5, 16).floating)];
    expect(ids).toEqual(["asset-late"]);
  });

  it("slicing twice keeps the clock honest", () => {
    const twice = sliceExportPlan(sliceExportPlan(plan, 2, 16), 3, 10);
    const once = sliceExportPlan(plan, 5, 12);
    expect(twice.floating?.timeOffset).toBe(once.floating?.timeOffset);
  });
});

describe("floatingLiveAt", () => {
  it("is true exactly while an item draws something, fades included", () => {
    // Illustrative: an image anchored at source 1 (timeline 4) for 2 s, fading in over 0.5 s.
    const plan = buildExportPlan(scene([img("a", 1, 2, 1, { fadeInMs: 500 })]));
    expect(floatingLiveAt(plan.floating, 3.9)).toBe(false);
    // Opacity is 0 at the very start of a fade-in: nothing is drawn yet.
    expect(floatingLiveAt(plan.floating, 4)).toBe(false);
    expect(floatingLiveAt(plan.floating, 4.1)).toBe(true);
    expect(floatingLiveAt(plan.floating, 5.9)).toBe(true);
    expect(floatingLiveAt(plan.floating, 6)).toBe(false);
  });

  it("is false without a plan or without items", () => {
    expect(floatingLiveAt(undefined, 1)).toBe(false);
    expect(floatingLiveAt({ items: [], layout: [], timeOffset: 0 }, 1)).toBe(false);
  });
});
