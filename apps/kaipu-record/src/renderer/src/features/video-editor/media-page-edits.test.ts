import { describe, expect, it } from "vitest";
import { MEDIA_MIN_DURATION, mediaAt, placeMedia } from "./media";
import {
  addFloatingImage,
  deleteMediaItem,
  dropMediaWithoutAsset,
  fillPicture,
  isMediaPlaced,
  moveMediaTo,
  putInCorner,
  reorderMediaItem,
  resizeMediaEdgeTo,
  setMediaBoxOf,
  setMediaDurationSeconds,
  setMediaFadesOf,
} from "./media-page-edits";
import { initialScene, type VideoScene } from "./scene";
import { toLayout } from "./timeline";

const picture = { width: 1920, height: 1080 };

function base(): VideoScene {
  return {
    ...initialScene(60),
    items: [
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 30 },
      { id: "b", kind: "clip", sourceStart: 30, sourceEnd: 60 },
    ],
  };
}

function withTwo(): VideoScene {
  let scene = addFloatingImage(base(), {
    id: "one",
    assetId: "asset-one",
    naturalWidth: 800,
    naturalHeight: 800,
    playhead: 5,
    picture,
  });
  scene = addFloatingImage(scene, {
    id: "two",
    assetId: "asset-two",
    naturalWidth: 1600,
    naturalHeight: 900,
    playhead: 8,
    picture,
  });
  return scene;
}

describe("addFloatingImage (levels flag on)", () => {
  it("adds an item at the playhead, 10 s, fitted and in front, without touching the sequence", () => {
    const scene = base();
    const next = addFloatingImage(scene, {
      id: "m",
      assetId: "asset",
      naturalWidth: 800,
      naturalHeight: 800,
      playhead: 10,
      picture,
    });
    expect(next.items).toBe(scene.items);
    expect(toLayout(next.items)).toEqual(toLayout(scene.items));
    const [placed] = placeMedia(next.media, toLayout(next.items));
    expect([placed.start, placed.end]).toEqual([10, 20]);
    // A square image in a 16:9 picture is fitted by its height: 9/16 of the width.
    expect(placed.item.box.width).toBeCloseTo(0.5625);
    expect(placed.item.box.x).toBe(0.5);
  });

  it("puts a second image in front of the first", () => {
    const scene = withTwo();
    const z = Object.fromEntries(scene.media!.map((m) => [m.id, m.z]));
    expect(z.two).toBeGreaterThan(z.one);
  });
});

describe("dropMediaWithoutAsset", () => {
  it("drops the floating items whose asset was not restored", () => {
    const next = dropMediaWithoutAsset(withTwo(), new Set(["asset-two"]));
    expect(next.media!.map((m) => m.id)).toEqual(["two"]);
  });

  it("keeps the scene, and an absent `media`, as they are when there is nothing to drop", () => {
    const scene = base();
    expect(dropMediaWithoutAsset(scene, new Set())).toBe(scene);
    expect("media" in dropMediaWithoutAsset(scene, new Set())).toBe(false);
    const full = withTwo();
    expect(dropMediaWithoutAsset(full, new Set(["asset-one", "asset-two"]))).toBe(full);
  });
});

describe("a selection follows the footage", () => {
  it("is no longer placed once the footage under the item's start is deleted, and is again after undo", () => {
    const scene = withTwo();
    expect(isMediaPlaced(scene, "one")).toBe(true);
    // Delete clip "a" (source 0..30): both items were anchored there.
    const deleted: VideoScene = { ...scene, items: scene.items.filter((i) => i.id !== "a") };
    expect(isMediaPlaced(deleted, "one")).toBe(false);
    // The item stays in scene.media: undo restores the previous scene, which places it again.
    expect(deleted.media).toBe(scene.media);
    // Gone from the preview and export draw list too.
    expect(mediaAt(deleted, toLayout(deleted.items), 6)).toEqual([]);
    expect(isMediaPlaced(scene, "one")).toBe(true);
  });
});

describe("panel actions each produce one scene change", () => {
  it("Full and Box set the box; applying one twice is no change", () => {
    const scene = withTwo();
    const corner = putInCorner(scene, "two", picture);
    expect(corner).not.toBe(scene);
    expect(corner.media!.find((m) => m.id === "two")!.box.width).toBeCloseTo(0.4);
    expect(putInCorner(corner, "two", picture)).toBe(corner);
    const full = fillPicture(corner, "two", picture);
    expect(full.media!.find((m) => m.id === "two")!.box).toEqual({ x: 0.5, y: 0.5, width: 1 });
    expect(fillPicture(full, "two", picture)).toBe(full);
  });

  it("Bring forward and Send backward swap an overlapping pair, and report no change at the ends", () => {
    const scene = withTwo();
    const back = reorderMediaItem(scene, "two", "backward");
    expect(back).not.toBe(scene);
    const z = Object.fromEntries(back.media!.map((m) => [m.id, m.z]));
    expect(z.one).toBeGreaterThan(z.two);
    // "two" is already in front, "one" is now in front: forward has nothing to pass.
    expect(reorderMediaItem(scene, "two", "forward")).toBe(scene);
    expect(reorderMediaItem(back, "one", "forward")).toBe(back);
  });

  it("fades clamp to 0–2000 ms", () => {
    const scene = withTwo();
    const next = setMediaFadesOf(scene, "one", { fadeInMs: 5000, fadeOutMs: -3 });
    const item = next.media!.find((m) => m.id === "one")!;
    expect([item.fadeInMs, item.fadeOutMs]).toEqual([2000, 0]);
    expect(setMediaFadesOf(next, "one", { fadeInMs: 2000 })).toBe(next);
  });

  it("Delete removes only that item", () => {
    const scene = withTwo();
    const next = deleteMediaItem(scene, "one");
    expect(next.media!.map((m) => m.id)).toEqual(["two"]);
    expect(deleteMediaItem(next, "one")).toBe(next);
  });

  it("the duration field moves the end edge and respects the minimum", () => {
    const scene = withTwo();
    const longer = setMediaDurationSeconds(scene, "one", 4);
    expect(longer.media!.find((m) => m.id === "one")!.duration).toBe(4);
    const tiny = setMediaDurationSeconds(scene, "one", 0.01);
    expect(tiny.media!.find((m) => m.id === "one")!.duration).toBe(MEDIA_MIN_DURATION);
    expect(setMediaDurationSeconds(scene, "one", Number.NaN)).toBe(scene);
  });
});

describe("live edits", () => {
  it("move and edge resize go through the model; a box change leaves the anchor alone", () => {
    const scene = withTwo();
    const moved = moveMediaTo(scene, "one", 20);
    expect(
      placeMedia(moved.media, toLayout(moved.items)).find((p) => p.item.id === "one")!.start,
    ).toBe(20);
    const resized = resizeMediaEdgeTo(scene, "one", "end", 9);
    expect(resized.media!.find((m) => m.id === "one")!.duration).toBe(4);
    const boxed = setMediaBoxOf(scene, "one", { x: 0.3, y: 0.4, width: 0.2 });
    expect(boxed.media!.find((m) => m.id === "one")!.anchor).toEqual(
      scene.media!.find((m) => m.id === "one")!.anchor,
    );
  });
});
