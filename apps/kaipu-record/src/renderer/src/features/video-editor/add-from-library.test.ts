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
  FLOATING_IMAGE_SECONDS,
  boundaryForDestination,
  defaultDestination,
  destinationAllowed,
  insertSlideAtBoundary,
  LIBRARY_DESTINATIONS,
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
