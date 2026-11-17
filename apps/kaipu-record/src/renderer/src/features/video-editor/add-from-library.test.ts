import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { boundaryIndexAt, toLayout, type LayoutEntry } from "./timeline";
import { initialScene, type SlideItem, type VideoScene } from "./scene";
import {
  anchoredBoundary,
  joinableRecordings,
  resolutionLabel,
  insertBoundaryAt,
  boundaryAfterClipAt,
  boundaryBeforeClipAt,
  boundaryAtStart,
  boundaryAtEnd,
  libraryScreenshots,
  placementPreview,
  condensePlacement,
  schematicPlacement,
  sameAsDestination,
  FLOATING_IMAGE_SECONDS,
  boundaryForDestination,
  defaultDestination,
  destinationAllowed,
  insertSlideAtBoundary,
  LIBRARY_DESTINATIONS,
  type LibraryDestination,
  SEQUENCE_IMAGE_SECONDS,
} from "./add-from-library";

function video(over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: `id-${over.assetId}`,
    kind: "recording",
    title: `Title ${over.assetId}`,
    createdAt: 1,
    durationSeconds: 10,
    derivedFromAssetId: null,
    ...over,
  } as LibraryVideo;
}

const ids = (videos: LibraryVideo[]): string[] => videos.map((v) => v.assetId);

describe("joinableRecordings", () => {
  it("keeps only Kaipu recordings: no screenshots, no gifs", () => {
    const list = [
      video({ assetId: "a" }),
      video({ assetId: "shot", kind: "screenshot" }),
      video({ assetId: "gif", kind: "gif" }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["a"]);
  });

  it("leaves out the recording being edited, by asset id", () => {
    const list = [video({ assetId: "opened" }), video({ assetId: "other" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["other"]);
  });

  it("leaves out a cloud-only recording, which has no local file to join", () => {
    const list = [video({ assetId: "cloud", id: null }), video({ assetId: "local" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["local"]);
  });

  it("leaves out exports, which are derived from another recording", () => {
    const list = [video({ assetId: "export", derivedFromAssetId: "a" }), video({ assetId: "a" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["a"]);
  });

  it("leaves out a recording whose sidecar could not be read", () => {
    const list = [
      video({ assetId: "broken", metadataIssue: "unreadable" }),
      video({ assetId: "fine" }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["fine"]);
  });

  it("leaves out a recording too short to make a clip", () => {
    const list = [
      video({ assetId: "empty", durationSeconds: 0 }),
      video({ assetId: "sliver", durationSeconds: 0.05 }),
      video({ assetId: "ok", durationSeconds: 0.1 }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["ok"]);
  });

  it("lists newest first", () => {
    const list = [
      video({ assetId: "old", createdAt: 1 }),
      video({ assetId: "new", createdAt: 3 }),
      video({ assetId: "mid", createdAt: 2 }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["new", "mid", "old"]);
  });

  it("matches the title case-insensitively on the trimmed query", () => {
    const list = [
      video({ assetId: "a", title: "Checkout bug" }),
      video({ assetId: "b", title: "Signup flow" }),
    ];
    expect(ids(joinableRecordings(list, "opened", "  CHECK "))).toEqual(["a"]);
    expect(ids(joinableRecordings(list, "opened", "nothing"))).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    const list = [video({ assetId: "a" }), video({ assetId: "b" })];
    expect(ids(joinableRecordings(list, "opened", "   "))).toHaveLength(2);
  });

  it("keeps a recording the scene already joined: joining it again is a new copy", () => {
    // The scene is not an input: nothing about "already joined" removes a row.
    const list = [video({ assetId: "joined-before" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["joined-before"]);
  });
});

describe("resolutionLabel", () => {
  it("writes the capture size as width × height", () => {
    const v = video({ assetId: "a", capture: { width: 1440, height: 1080 } as never });
    expect(resolutionLabel(v)).toBe("1440 × 1080");
  });

  it("is null when the capture is unknown", () => {
    expect(resolutionLabel(video({ assetId: "a", capture: null }))).toBeNull();
    expect(resolutionLabel(video({ assetId: "a" }))).toBeNull();
  });

  it("is null when the size is zero or missing", () => {
    expect(
      resolutionLabel(video({ assetId: "a", capture: { width: 0, height: 0 } as never })),
    ).toBeNull();
  });
});

function clip(itemId: string, timelineStart: number, timelineEnd: number): LayoutEntry {
  return { itemId, kind: "clip", timelineStart, timelineEnd, sourceStart: 0, sourceEnd: 0 };
}

describe("insertBoundaryAt", () => {
  const two = [clip("a", 0, 10), clip("b", 10, 25)];

  it("before the first clip, snaps to the start", () => {
    expect(insertBoundaryAt(two, 1)).toEqual({ index: 0, time: 0 });
    expect(insertBoundaryAt(two, -3)).toEqual({ index: 0, time: 0 });
  });

  it("between two clips, snaps to the nearer edge: the seam when the pointer is close to it", () => {
    expect(insertBoundaryAt(two, 9)).toEqual({ index: 1, time: 10 });
    expect(insertBoundaryAt(two, 12)).toEqual({ index: 1, time: 10 });
  });

  it("after the last clip, snaps to the end", () => {
    expect(insertBoundaryAt(two, 24)).toEqual({ index: 2, time: 25 });
    expect(insertBoundaryAt(two, 99)).toEqual({ index: 2, time: 25 });
  });

  it("with a single clip, offers its start or its end", () => {
    const one = [clip("a", 0, 30)];
    expect(insertBoundaryAt(one, 5)).toEqual({ index: 0, time: 0 });
    expect(insertBoundaryAt(one, 20)).toEqual({ index: 1, time: 30 });
  });

  it("is the same boundary the join picks for that time, so the indicator shows where the clip lands", () => {
    const layout = [clip("a", 0, 4), clip("b", 4, 9), clip("c", 9, 20)];
    for (const t of [0, 1.9, 2.1, 6, 6.6, 7, 14, 14.6, 30]) {
      const at = insertBoundaryAt(layout, t);
      expect(at.index).toBe(boundaryIndexAt(layout, t));
      // Handing the join the boundary's own time lands on the same boundary.
      expect(boundaryIndexAt(layout, at.time)).toBe(at.index);
    }
  });

  it("says the start for an empty layout", () => {
    expect(insertBoundaryAt([], 5)).toEqual({ index: 0, time: 0 });
  });
});

describe("anchoredBoundary", () => {
  // illustrative: opened 30 s recording P, then a 20 s clip B inserted ahead of it
  const opened = initialScene(30);
  const prepended = (scene: VideoScene): VideoScene => ({
    ...scene,
    items: [{ id: "b", kind: "clip", sourceStart: 0, sourceEnd: 20 }, ...scene.items],
  });

  it("follows the clip after the boundary when another clip was inserted ahead of it", () => {
    const two: VideoScene = {
      ...opened,
      items: [
        { id: "p", kind: "clip", sourceStart: 0, sourceEnd: 10 },
        { id: "q", kind: "clip", sourceStart: 10, sourceEnd: 30 },
      ],
    };
    const resolve = anchoredBoundary(toLayout(two.items), 10);
    expect(resolve(two)).toBe(10);
    expect(resolve(prepended(two))).toBe(30);
  });

  it("with a following clip at boundary 0, stays at 0 while that clip is still first", () => {
    const resolve = anchoredBoundary(toLayout(opened.items), 0);
    expect(resolve(opened)).toBe(0);
    // another clip inserted at 0 before this join: the anchor P moves to 20, so the new clip
    // goes right before P, after the first one
    expect(resolve(prepended(opened))).toBe(20);
  });

  it("with no following clip, means the end of the sequence as it is by then", () => {
    const resolve = anchoredBoundary(toLayout(opened.items), 30);
    expect(resolve(opened)).toBe(30);
    expect(resolve(prepended(opened))).toBe(50);
  });

  it("falls back to the original boundary time when the anchor clip was removed", () => {
    const two: VideoScene = {
      ...opened,
      items: [
        { id: "p", kind: "clip", sourceStart: 0, sourceEnd: 10 },
        { id: "q", kind: "clip", sourceStart: 10, sourceEnd: 30 },
      ],
    };
    const resolve = anchoredBoundary(toLayout(two.items), 10);
    const withoutQ: VideoScene = { ...two, items: [two.items[0]] };
    expect(resolve(withoutQ)).toBe(10);
  });

  it("is 0 for the end of an empty sequence", () => {
    const resolve = anchoredBoundary([], 5);
    expect(resolve({ ...opened, items: [] })).toBe(0);
  });
});

describe("boundaryAfterClipAt", () => {
  // illustrative: three clips of 10 s, 20 s and 5 s, ending at 10, 30 and 35
  const three = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 30 },
    { id: "c", kind: "clip", sourceStart: 30, sourceEnd: 35 },
  ]);

  it("a playhead at 169 s inside one 2040 s clip lands after it, not at 0", () => {
    const one = toLayout([{ id: "p", kind: "clip", sourceStart: 0, sourceEnd: 2040 }]);
    expect(boundaryAfterClipAt(one, 169)).toEqual({ index: 1, time: 2040 });
    // the old nearest-boundary rule picked the start here
    expect(insertBoundaryAt(one, 169).index).toBe(0);
  });

  it("inside the second of three clips lands after the second, even nearer its start", () => {
    expect(boundaryAfterClipAt(three, 11)).toEqual({ index: 2, time: 30 });
    expect(boundaryAfterClipAt(three, 29)).toEqual({ index: 2, time: 30 });
  });

  it("at an exact boundary lands after the clip that ends there", () => {
    expect(boundaryAfterClipAt(three, 10)).toEqual({ index: 1, time: 10 });
    expect(boundaryAfterClipAt(three, 30)).toEqual({ index: 2, time: 30 });
  });

  it("at 0 or before lands after the first clip", () => {
    expect(boundaryAfterClipAt(three, 0)).toEqual({ index: 1, time: 10 });
    expect(boundaryAfterClipAt(three, -4)).toEqual({ index: 1, time: 10 });
  });

  it("at or past the end of the sequence lands at the end", () => {
    expect(boundaryAfterClipAt(three, 35)).toEqual({ index: 3, time: 35 });
    expect(boundaryAfterClipAt(three, 99)).toEqual({ index: 3, time: 35 });
  });

  it("an empty sequence lands at 0", () => {
    expect(boundaryAfterClipAt([], 5)).toEqual({ index: 0, time: 0 });
  });

  it("a slide counts as the clip under the playhead", () => {
    const withSlide = toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
      { id: "s", kind: "slide", assetId: "img", duration: 4, naturalWidth: 8, naturalHeight: 6 },
      { id: "c", kind: "clip", sourceStart: 10, sourceEnd: 20 },
    ]);
    expect(boundaryAfterClipAt(withSlide, 12)).toEqual({ index: 2, time: 14 });
  });
});

describe("boundaryBeforeClipAt", () => {
  // illustrative: three clips of 10 s, 20 s and 5 s, ending at 10, 30 and 35
  const three = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 30 },
    { id: "c", kind: "clip", sourceStart: 30, sourceEnd: 35 },
  ]);

  it("inside the first clip lands at the start", () => {
    expect(boundaryBeforeClipAt(three, 4)).toEqual({ index: 0, time: 0 });
    expect(boundaryBeforeClipAt(three, 0)).toEqual({ index: 0, time: 0 });
    expect(boundaryBeforeClipAt(three, -2)).toEqual({ index: 0, time: 0 });
  });

  it("inside a later clip lands where that clip starts", () => {
    expect(boundaryBeforeClipAt(three, 11)).toEqual({ index: 1, time: 10 });
    expect(boundaryBeforeClipAt(three, 29)).toEqual({ index: 1, time: 10 });
    expect(boundaryBeforeClipAt(three, 32)).toEqual({ index: 2, time: 30 });
  });

  it("exactly on a cut means the clip that ends there, like after", () => {
    expect(boundaryBeforeClipAt(three, 10)).toEqual({ index: 0, time: 0 });
    expect(boundaryBeforeClipAt(three, 30)).toEqual({ index: 1, time: 10 });
    // after for the same playhead: the pair brackets that one clip
    expect(boundaryAfterClipAt(three, 30)).toEqual({ index: 2, time: 30 });
  });

  it("at the end of the sequence means the last clip; past it there is no clip, so the end", () => {
    expect(boundaryBeforeClipAt(three, 35)).toEqual({ index: 2, time: 30 });
    expect(boundaryBeforeClipAt(three, 99)).toEqual({ index: 3, time: 35 });
  });

  it("an empty sequence lands at 0, and a one-clip one at its start", () => {
    expect(boundaryBeforeClipAt([], 5)).toEqual({ index: 0, time: 0 });
    const one = toLayout([{ id: "p", kind: "clip", sourceStart: 0, sourceEnd: 40 }]);
    expect(boundaryBeforeClipAt(one, 20)).toEqual({ index: 0, time: 0 });
  });

  it("a slide counts as the clip under the playhead", () => {
    const withSlide = toLayout([
      { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
      { id: "s", kind: "slide", assetId: "img", duration: 4, naturalWidth: 8, naturalHeight: 6 },
      { id: "c", kind: "clip", sourceStart: 10, sourceEnd: 20 },
    ]);
    expect(boundaryBeforeClipAt(withSlide, 12)).toEqual({ index: 1, time: 10 });
  });
});

describe("destinations", () => {
  const layout = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 30 },
  ]);

  it("maps each sequence destination to its boundary and 'over' to none", () => {
    expect(boundaryForDestination("over", layout, 12)).toBeNull();
    expect(boundaryForDestination("before-clip", layout, 12)).toEqual({ index: 1, time: 10 });
    expect(boundaryForDestination("after-clip", layout, 12)).toEqual({ index: 2, time: 30 });
    expect(boundaryForDestination("start", layout, 12)).toEqual({ index: 0, time: 0 });
    expect(boundaryForDestination("end", layout, 12)).toEqual({ index: 2, time: 30 });
  });

  it("a screenshot defaults to over the video, a recording to after the clip", () => {
    expect(defaultDestination("screenshot")).toBe("over");
    expect(defaultDestination("recording")).toBe("after-clip");
  });

  it("a recording can never go over the video; a screenshot can go anywhere", () => {
    expect(destinationAllowed("recording", "over")).toBe(false);
    for (const destination of LIBRARY_DESTINATIONS) {
      expect(destinationAllowed("screenshot", destination)).toBe(true);
      if (destination !== "over") expect(destinationAllowed("recording", destination)).toBe(true);
    }
  });
});

describe("insertSlideAtBoundary", () => {
  const slide: SlideItem = {
    id: "new",
    kind: "slide",
    assetId: "img",
    duration: SEQUENCE_IMAGE_SECONDS,
    naturalWidth: 8,
    naturalHeight: 6,
  };
  const scene: VideoScene = {
    ...initialScene(30),
    items: [
      { id: "p", kind: "clip", sourceStart: 0, sourceEnd: 10 },
      { id: "q", kind: "clip", sourceStart: 10, sourceEnd: 30 },
    ],
  };
  const idsOf = (s: VideoScene): string[] => s.items.map((item) => item.id);

  it("is 5 s in the sequence, not the 3 s of the old Add to timeline", () => {
    expect(SEQUENCE_IMAGE_SECONDS).toBe(5);
  });

  it("puts the slide at the item index the chosen boundary names", () => {
    const layout = toLayout(scene.items);
    for (const [boundary, expected] of [
      [boundaryAtStart(), ["new", "p", "q"]],
      [boundaryAfterClipAt(layout, 3), ["p", "new", "q"]],
      [boundaryBeforeClipAt(layout, 12), ["p", "new", "q"]],
      [boundaryAtEnd(layout), ["p", "q", "new"]],
    ] as const) {
      const next = insertSlideAtBoundary(scene, slide, anchoredBoundary(layout, boundary));
      expect(idsOf(next)).toEqual(expected);
    }
  });

  it("follows the clip after the boundary when the scene changed during the decode", () => {
    const layout = toLayout(scene.items);
    const resolve = anchoredBoundary(layout, boundaryAfterClipAt(layout, 3));
    // a join landed at the start while the image was decoding
    const moved: VideoScene = {
      ...scene,
      items: [{ id: "j", kind: "clip", sourceStart: 0, sourceEnd: 20 }, ...scene.items],
    };
    expect(idsOf(insertSlideAtBoundary(moved, slide, resolve))).toEqual(["j", "p", "new", "q"]);
  });

  it("maps the boundary onto items when a zero-length item is skipped by the layout", () => {
    const withEmpty: VideoScene = {
      ...scene,
      items: [
        { id: "p", kind: "clip", sourceStart: 0, sourceEnd: 10 },
        { id: "z", kind: "clip", sourceStart: 10, sourceEnd: 10 },
        { id: "q", kind: "clip", sourceStart: 10, sourceEnd: 30 },
      ],
    };
    const layout = toLayout(withEmpty.items);
    const atEnd = anchoredBoundary(layout, boundaryAtEnd(layout));
    expect(idsOf(insertSlideAtBoundary(withEmpty, slide, atEnd))).toEqual(["p", "z", "q", "new"]);
  });

  it("an empty scene takes the slide first", () => {
    const empty: VideoScene = { ...scene, items: [] };
    const next = insertSlideAtBoundary(empty, slide, anchoredBoundary([], boundaryAtEnd([])));
    expect(idsOf(next)).toEqual(["new"]);
  });
});

describe("anchoredBoundary from a chosen boundary", () => {
  it("pins the click-time boundary to the clip after it, not the nearest one at the join", () => {
    const two: VideoScene = {
      ...initialScene(30),
      items: [
        { id: "p", kind: "clip", sourceStart: 0, sourceEnd: 10 },
        { id: "q", kind: "clip", sourceStart: 10, sourceEnd: 30 },
      ],
    };
    const resolve = anchoredBoundary(
      toLayout(two.items),
      boundaryAfterClipAt(toLayout(two.items), 2),
    );
    expect(resolve(two)).toBe(10);
    const prepended: VideoScene = {
      ...two,
      items: [{ id: "b", kind: "clip", sourceStart: 0, sourceEnd: 20 }, ...two.items],
    };
    expect(resolve(prepended)).toBe(30);
  });
});

describe("boundaryAtStart and boundaryAtEnd", () => {
  // illustrative: clips of 10 s and 20 s, ending at 10 and 30
  const two = toLayout([
    { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
    { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 30 },
  ]);

  it("the start is index 0 at time 0", () => {
    expect(boundaryAtStart()).toEqual({ index: 0, time: 0 });
  });

  it("the end is after the last clip: its index is the layout length, its time the last end", () => {
    expect(boundaryAtEnd(two)).toEqual({ index: 2, time: 30 });
  });

  it("an empty sequence has its start and its end at 0", () => {
    expect(boundaryAtEnd([])).toEqual({ index: 0, time: 0 });
  });

  it("anchoring the end pins no clip, so it stays the end however many are added ahead", () => {
    const resolve = anchoredBoundary(two, boundaryAtEnd(two));
    const longer: VideoScene = {
      ...initialScene(30),
      items: [
        { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
        { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 30 },
        { id: "n", kind: "clip", sourceStart: 30, sourceEnd: 40 },
      ],
    };
    expect(resolve(longer)).toBe(40);
  });
});

describe("libraryScreenshots", () => {
  it("keeps only screenshots with a local file: no recordings, no GIFs, no cloud-only items", () => {
    const list = [
      video({ assetId: "rec" }),
      video({ assetId: "gif", kind: "gif" }),
      video({ assetId: "cloud", kind: "screenshot", id: null }),
      video({ assetId: "shot", kind: "screenshot" }),
    ];
    expect(ids(libraryScreenshots(list, ""))).toEqual(["shot"]);
  });

  it("lists newest first", () => {
    const list = [
      video({ assetId: "old", kind: "screenshot", createdAt: 1 }),
      video({ assetId: "new", kind: "screenshot", createdAt: 9 }),
    ];
    expect(ids(libraryScreenshots(list, ""))).toEqual(["new", "old"]);
  });

  it("matches the title case-insensitively on the trimmed query", () => {
    const list = [
      video({ assetId: "a", kind: "screenshot", title: "Screenshot Pricing page" }),
      video({ assetId: "b", kind: "screenshot", title: "Screenshot Login" }),
    ];
    expect(ids(libraryScreenshots(list, "  PRICING "))).toEqual(["a"]);
    // Same createdAt, so a blank query keeps both.
    expect(libraryScreenshots(list, "   ")).toHaveLength(2);
  });
});

describe("placementPreview", () => {
  // Three clips: a 0-8, b 8-20, c 20-30. The playhead sits in b unless a test says otherwise.
  const layout = [clip("a", 0, 8), clip("b", 8, 20), clip("c", 20, 30)];
  const spans = (preview: ReturnType<typeof placementPreview>): Array<[string, number, number]> =>
    preview.blocks.map((b) => [b.key, b.start, b.end]);

  it("after the clip: the new block follows the clip under the playhead and pushes only what is after", () => {
    const preview = placementPreview(layout, 12, "after-clip", 7);
    expect(spans(preview)).toEqual([
      ["a", 0, 8],
      ["b", 8, 20],
      ["new", 20, 27],
      ["c", 27, 37],
    ]);
    expect(preview.blocks.filter((b) => b.moved).map((b) => b.key)).toEqual(["c"]);
    expect(preview.blocks.find((b) => b.key === "new")?.isNew).toBe(true);
    expect(preview.moved).toBe(1);
    expect(preview.total).toBe(37);
    expect(preview.floating).toBeNull();
    expect(preview.playhead).toBe(12);
  });

  it("before the clip: the clip under the playhead moves, and the marker moves with it", () => {
    const preview = placementPreview(layout, 12, "before-clip", 7);
    expect(spans(preview)).toEqual([
      ["a", 0, 8],
      ["new", 8, 15],
      ["b", 15, 27],
      ["c", 27, 37],
    ]);
    expect(preview.moved).toBe(2);
    expect(preview.playhead).toBe(19);
  });

  it("at the start: everything moves", () => {
    const preview = placementPreview(layout, 12, "start", 7);
    expect(spans(preview)).toEqual([
      ["new", 0, 7],
      ["a", 7, 15],
      ["b", 15, 27],
      ["c", 27, 37],
    ]);
    expect(preview.moved).toBe(3);
    expect(preview.playhead).toBe(19);
  });

  it("at the end: nothing moves and the marker stays", () => {
    const preview = placementPreview(layout, 12, "end", 7);
    expect(spans(preview)).toEqual([
      ["a", 0, 8],
      ["b", 8, 20],
      ["c", 20, 30],
      ["new", 30, 37],
    ]);
    expect(preview.moved).toBe(0);
    expect(preview.playhead).toBe(12);
  });

  it("over the video: the clips stay and the item floats from the playhead", () => {
    const preview = placementPreview(layout, 12, "over", 10);
    expect(spans(preview)).toEqual([
      ["a", 0, 8],
      ["b", 8, 20],
      ["c", 20, 30],
    ]);
    expect(preview.blocks.some((b) => b.isNew || b.moved)).toBe(false);
    expect(preview.floating).toEqual({ start: 12, end: 22 });
    expect(preview.moved).toBe(0);
    expect(preview.total).toBe(30);
    expect(preview.playhead).toBe(12);
  });

  it("over the video is cut at the end of the video, as the floating image is", () => {
    const preview = placementPreview(layout, 27, "over", FLOATING_IMAGE_SECONDS);
    expect(preview.floating).toEqual({ start: 27, end: 30 });
    expect(preview.total).toBe(30);
  });

  it("an empty sequence is just the new block", () => {
    for (const destination of ["before-clip", "after-clip", "start", "end"] as const) {
      const preview = placementPreview([], 0, destination, 5);
      expect(spans(preview)).toEqual([["new", 0, 5]]);
      expect(preview.moved).toBe(0);
      expect(preview.total).toBe(5);
      expect(preview.playhead).toBe(0);
    }
  });

  it("a playhead in the last clip with after-clip moves nothing", () => {
    const preview = placementPreview(layout, 25, "after-clip", 7);
    expect(spans(preview).map(([key]) => key)).toEqual(["a", "b", "c", "new"]);
    expect(preview.moved).toBe(0);
    expect(preview.playhead).toBe(25);
  });

  it("a playhead past the end waits at the end of the sequence", () => {
    const preview = placementPreview(layout, 99, "after-clip", 7);
    expect(spans(preview).at(-1)).toEqual(["new", 30, 37]);
    expect(preview.playhead).toBe(30);
  });

  it("slides count as clips", () => {
    const withSlide: LayoutEntry[] = [
      clip("a", 0, 8),
      {
        itemId: "s",
        kind: "slide",
        timelineStart: 8,
        timelineEnd: 13,
        sourceStart: 0,
        sourceEnd: 5,
      },
      clip("c", 13, 23),
    ];
    const preview = placementPreview(withSlide, 3, "after-clip", 4);
    expect(spans(preview)).toEqual([
      ["a", 0, 8],
      ["new", 8, 12],
      ["s", 12, 17],
      ["c", 17, 27],
    ]);
    expect(preview.moved).toBe(2);
  });

  it("lands where the add does: the new block starts at the boundary the add uses", () => {
    for (const destination of ["before-clip", "after-clip", "start", "end"] as const) {
      for (const playhead of [0, 8, 12, 20, 29, 30, 50]) {
        const boundary = boundaryForDestination(destination, layout, playhead);
        const preview = placementPreview(layout, playhead, destination, 4);
        const at = preview.blocks.findIndex((b) => b.isNew);
        expect(at).toBe(boundary?.index);
        expect(preview.blocks[at].start).toBe(boundary?.time);
      }
    }
  });
});

describe("condensePlacement", () => {
  // Illustrative: ten 10 s clips c0..c9, the playhead in c4 (index 4, 40-50), a 7 s item.
  const ten = Array.from({ length: 10 }, (_, i) => clip(`c${i}`, i * 10, i * 10 + 10));
  const NEW = 7;
  const shape = (destination: LibraryDestination, layout = ten, playhead = 45) => {
    const condensed = condensePlacement(placementPreview(layout, playhead, destination, NEW));
    return {
      condensed,
      kinds: condensed.slots.map((slot) =>
        slot.kind === "group" ? `group:${slot.count}` : slot.kind === "new" ? "new" : slot.key,
      ),
    };
  };

  it("after the clip: the groups hide the far clips and everything near the playhead and the new item stays", () => {
    const { condensed, kinds } = shape("after-clip");
    expect(kinds).toEqual(["group:3", "c3", "c4", "new", "c5", "group:4"]);
    expect(condensed.slots.filter((s) => s.current).map((s) => s.key)).toEqual(["c4"]);
    expect(condensed.slots.map((s) => s.moved)).toEqual([false, false, false, false, true, true]);
  });

  it("before the clip: the new item sits left of the clip the playhead is on, which moves", () => {
    const { condensed, kinds } = shape("before-clip");
    expect(kinds).toEqual(["group:3", "c3", "new", "c4", "c5", "group:4"]);
    expect(condensed.slots.find((s) => s.current)?.key).toBe("c4");
    expect(condensed.slots.map((s) => s.moved)).toEqual([false, false, false, true, true, true]);
  });

  it("at the start: new and its neighbour, then a group, the playhead's clip with its neighbours, a group", () => {
    const { condensed, kinds } = shape("start");
    expect(kinds).toEqual(["new", "c0", "group:2", "c3", "c4", "c5", "group:4"]);
    expect(condensed.slots.find((s) => s.current)?.key).toBe("c4");
    expect(condensed.slots.filter((s) => s.kind !== "new").every((s) => s.moved)).toBe(true);
  });

  it("at the end: nothing moves, the new item closes the strip", () => {
    const { condensed, kinds } = shape("end");
    expect(kinds).toEqual(["group:3", "c3", "c4", "c5", "group:3", "c9", "new"]);
    expect(condensed.slots.some((s) => s.moved)).toBe(false);
  });

  it("over: the same condensing with no new block, and the floating bar is on the strip", () => {
    const { condensed, kinds } = shape("over");
    expect(kinds).toEqual(["group:3", "c3", "c4", "c5", "group:4"]);
    expect(condensed.slots.some((s) => s.kind === "new" || s.moved)).toBe(false);
    expect(condensed.floating).not.toBeNull();
    const current = condensed.slots.find((s) => s.current);
    expect(condensed.floating?.x0).toBeCloseTo(condensed.x(45));
    expect(condensed.floating?.x0).toBeGreaterThanOrEqual(current?.x0 ?? 1);
    expect(condensed.floating?.x1).toBeCloseTo(condensed.x(52));
  });

  it("a run of one hidden clip is a plain clip, never a group of one", () => {
    // Playhead in c2: after-clip shows c1 c2 new c3, hides c0 (one clip) and c4..c9 (six).
    const { kinds } = shape("after-clip", ten, 25);
    expect(kinds).toEqual(["c0", "c1", "c2", "new", "c3", "group:6"]);
  });

  it("three clips draw no group: clip, clip, new, clip for after-clip with the playhead in the middle", () => {
    const three = [clip("a", 0, 8), clip("b", 8, 20), clip("c", 20, 30)];
    const { condensed } = shape("after-clip", three, 12);
    expect(condensed.slots.map((s) => s.kind)).toEqual(["clip", "clip", "new", "clip"]);
    expect(condensed.slots.map((s) => s.current)).toEqual([false, true, false, false]);
  });

  it("a one-clip video: the clip is current and the new item sits after it", () => {
    const one = [clip("a", 0, 12)];
    const { condensed } = shape("after-clip", one, 3);
    expect(condensed.slots.map((s) => s.kind)).toEqual(["clip", "new"]);
    expect(condensed.slots[0].current).toBe(true);
  });

  it("a tiny clip next to a long one gets at least the minimum share, and the shares sum to one", () => {
    const uneven = [clip("a", 0, 1), clip("b", 1, 601)];
    const { condensed } = shape("after-clip", uneven, 0.5);
    for (const slot of condensed.slots) expect(slot.x1 - slot.x0).toBeGreaterThanOrEqual(0.07);
    expect(condensed.slots[0].x0).toBeCloseTo(0);
    expect(condensed.slots.at(-1)?.x1).toBeCloseTo(1);
    for (let i = 1; i < condensed.slots.length; i++) {
      expect(condensed.slots[i].x0).toBeCloseTo(condensed.slots[i - 1].x1);
    }
  });

  it("a group is wide enough for its label", () => {
    const { condensed } = shape("after-clip");
    for (const slot of condensed.slots.filter((s) => s.kind === "group")) {
      expect(slot.x1 - slot.x0).toBeGreaterThanOrEqual(0.14);
    }
  });

  it("the playhead marker lies inside the current clip's slot, in every destination and place", () => {
    for (const destination of ["over", "before-clip", "after-clip", "start", "end"] as const) {
      for (const playhead of [0.5, 12, 45, 55, 99]) {
        const preview = placementPreview(ten, playhead, destination, NEW);
        const condensed = condensePlacement(preview);
        const current = condensed.slots.find((s) => s.current);
        expect(current).toBeDefined();
        const at = condensed.x(preview.playhead);
        expect(at).toBeGreaterThanOrEqual((current?.x0 ?? 1) - 1e-9);
        expect(at).toBeLessThanOrEqual((current?.x1 ?? 0) + 1e-9);
      }
    }
  });

  it("x maps the ends of the sequence to the ends of the strip", () => {
    const preview = placementPreview(ten, 45, "after-clip", NEW);
    const condensed = condensePlacement(preview);
    expect(condensed.x(0)).toBeCloseTo(0);
    expect(condensed.x(preview.total)).toBeCloseTo(1);
  });

  it("an empty sequence has no slots but the new one, and a floating item maps linearly", () => {
    expect(condensePlacement(placementPreview([], 0, "end", 5)).slots.map((s) => s.kind)).toEqual([
      "new",
    ]);
    const over = condensePlacement(placementPreview([], 0, "over", 5));
    expect(over.slots).toEqual([]);
    expect(over.floating).toEqual({ x0: 0, x1: 1 });
  });
});

describe("schematicPlacement", () => {
  const order = (destination: LibraryDestination): string[] =>
    schematicPlacement(destination).blocks.map((b) => b.key);
  const spans = (destination: LibraryDestination): Array<[number, number]> =>
    schematicPlacement(destination).blocks.map((b) => [b.start, b.end]);

  it("draws the design's three clips of 8, 12 and 10 and a new item of 7", () => {
    expect(order("start")).toEqual(["new", "c0", "c1", "c2"]);
    expect(order("before-clip")).toEqual(["c0", "new", "c1", "c2"]);
    expect(order("after-clip")).toEqual(["c0", "c1", "new", "c2"]);
    expect(order("end")).toEqual(["c0", "c1", "c2", "new"]);
    expect(order("over")).toEqual(["c0", "c1", "c2"]);
    expect(spans("after-clip")).toEqual([
      [0, 8],
      [8, 20],
      [20, 27],
      [27, 37],
    ]);
  });

  it("moves the clips after the new item and floats the item over the playhead", () => {
    const movedOf = (d: LibraryDestination): string[] =>
      schematicPlacement(d)
        .blocks.filter((b) => b.moved)
        .map((b) => b.key);
    expect(movedOf("start")).toEqual(["c0", "c1", "c2"]);
    expect(movedOf("before-clip")).toEqual(["c1", "c2"]);
    expect(movedOf("after-clip")).toEqual(["c2"]);
    expect(movedOf("end")).toEqual([]);
    expect(movedOf("over")).toEqual([]);
    const over = schematicPlacement("over");
    expect(over.floating).toEqual({ start: 12, end: 19 });
    expect(over.blocks.some((b) => b.isNew)).toBe(false);
  });

  it("keeps the playhead 4 s into the second clip wherever that clip lands", () => {
    const at = (d: LibraryDestination): number => schematicPlacement(d).playhead;
    expect(at("start")).toBe(19);
    expect(at("before-clip")).toBe(19);
    expect(at("after-clip")).toBe(12);
    expect(at("end")).toBe(12);
    expect(at("over")).toBe(12);
  });
});

describe("sameAsDestination", () => {
  const three = [clip("a", 0, 8), clip("b", 8, 20), clip("c", 20, 30)];
  const one = [clip("a", 0, 12)];

  it("after the clip on the last clip is the same as at the end", () => {
    expect(sameAsDestination("after-clip", three, 25)).toBe("end");
  });

  it("a one-clip video: after is the same as the end and before the same as the start", () => {
    expect(sameAsDestination("after-clip", one, 3)).toBe("end");
    expect(sameAsDestination("before-clip", one, 3)).toBe("start");
  });

  it("before the clip on the first clip is the same as at the start", () => {
    expect(sameAsDestination("before-clip", three, 3)).toBe("start");
  });

  it("a middle clip has no note, and neither do the other destinations", () => {
    expect(sameAsDestination("after-clip", three, 12)).toBeNull();
    expect(sameAsDestination("before-clip", three, 12)).toBeNull();
    expect(sameAsDestination("after-clip", three, 3)).toBeNull();
    expect(sameAsDestination("before-clip", three, 25)).toBeNull();
    for (const d of ["over", "start", "end"] as const) {
      expect(sameAsDestination(d, one, 3)).toBeNull();
    }
  });

  it("an empty sequence has no note", () => {
    expect(sameAsDestination("after-clip", [], 0)).toBeNull();
  });
});
