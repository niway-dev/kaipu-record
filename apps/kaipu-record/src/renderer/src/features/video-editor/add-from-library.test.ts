import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { boundaryIndexAt, toLayout, type LayoutEntry } from "./timeline";
import { initialScene, type VideoScene } from "./scene";
import {
  anchoredBoundary,
  joinableRecordings,
  resolutionLabel,
  insertBoundaryAt,
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
