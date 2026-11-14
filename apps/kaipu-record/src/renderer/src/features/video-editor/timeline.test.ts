import { describe, expect, it } from "vitest";
import type { TrackItem, VideoOverlay } from "./scene";
import { clipBounds, sourceAxis } from "./source-axis";
import {
  anchorAt,
  boundaryIndexAt,
  clampOverlays,
  clipAtSource,
  entryAt,
  insertItemAt,
  layoutDuration,
  MIN_ITEM_DURATION,
  removeItem,
  resolveAnchor,
  setSlideDuration,
  skipTarget,
  SKIP_SECONDS,
  sourceToTimeline,
  splitClipAt,
  timelineToSource,
  toLayout,
  trimClip,
} from "./timeline";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});

const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `asset-${id}`,
  duration,
  naturalWidth: 800,
  naturalHeight: 600,
});

// A representative edited track: 3s slide, then 0–10s of source, then 20–25s of source.
const ITEMS = [slide("s1", 3), clip("a", 0, 10), clip("b", 20, 25)];

describe("toLayout", () => {
  it("lays items out contiguously and remembers source ranges", () => {
    expect(toLayout(ITEMS)).toEqual([
      {
        itemId: "s1",
        kind: "slide",
        timelineStart: 0,
        timelineEnd: 3,
        sourceStart: 0,
        sourceEnd: 3,
        assetId: "asset-s1",
      },
      {
        itemId: "a",
        kind: "clip",
        timelineStart: 3,
        timelineEnd: 13,
        sourceStart: 0,
        sourceEnd: 10,
      },
      {
        itemId: "b",
        kind: "clip",
        timelineStart: 13,
        timelineEnd: 18,
        sourceStart: 20,
        sourceEnd: 25,
      },
    ]);
    expect(layoutDuration(toLayout(ITEMS))).toBe(18);
  });

  it("skips zero-duration items and returns [] for an empty track", () => {
    expect(toLayout([clip("z", 5, 5)])).toEqual([]);
    expect(layoutDuration([])).toBe(0);
  });
});

describe("entryAt", () => {
  const layout = toLayout(ITEMS);

  it("finds the entry containing a time", () => {
    expect(entryAt(layout, 0)?.itemId).toBe("s1");
    expect(entryAt(layout, 3)?.itemId).toBe("a"); // boundary belongs to the next entry
    expect(entryAt(layout, 17.9)?.itemId).toBe("b");
  });

  it("clamps out-of-range times instead of returning null", () => {
    expect(entryAt(layout, -1)?.itemId).toBe("s1");
    expect(entryAt(layout, 99)?.itemId).toBe("b");
    expect(entryAt([], 0)).toBeNull();
  });
});

describe("timelineToSource", () => {
  const layout = toLayout(ITEMS);

  it("maps timeline time into the source recording across cuts", () => {
    expect(timelineToSource(layout, 4)?.sourceTime).toBe(1); // 1s into clip a
    expect(timelineToSource(layout, 14)?.sourceTime).toBe(21); // 1s into clip b
  });

  it("maps slide time onto the slide's own 0..duration clock", () => {
    const hit = timelineToSource(layout, 1.5);
    expect(hit?.entry.itemId).toBe("s1");
    expect(hit?.sourceTime).toBe(1.5);
  });
});

describe("clipAtSource", () => {
  const layout = toLayout(ITEMS);

  it("finds the clip whose source range holds the time, bounds included", () => {
    expect(clipAtSource(layout, 1)?.itemId).toBe("a");
    expect(clipAtSource(layout, 10)?.itemId).toBe("a");
    expect(clipAtSource(layout, 20)?.itemId).toBe("b");
  });

  it("finds nothing in deleted footage, and never a slide", () => {
    expect(clipAtSource(layout, 15)).toBeUndefined();
    expect(clipAtSource(toLayout([slide("s1", 3)]), 1)).toBeUndefined();
  });

  it("prefers the earlier entry on a shared boundary (clips contiguous in source)", () => {
    const contiguous = toLayout([clip("x", 0, 5), clip("y", 5, 10)]);
    expect(clipAtSource(contiguous, 5)?.itemId).toBe("x");
  });
});

describe("sourceToTimeline", () => {
  const layout = toLayout(ITEMS);

  it("maps source time back to timeline time", () => {
    expect(sourceToTimeline(layout, 1)).toBe(4);
    expect(sourceToTimeline(layout, 21)).toBe(14);
  });

  it("returns null for deleted footage", () => {
    expect(sourceToTimeline(layout, 15)).toBeNull();
  });
});

describe("splitClipAt", () => {
  it("splits a clip into two at the timeline time, preserving source coverage", () => {
    const items = [clip("a", 20, 30)];
    const result = splitClipAt(items, 4); // 4s into the timeline = source 24
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "clip", sourceStart: 20, sourceEnd: 24 });
    expect(result[1]).toMatchObject({ kind: "clip", sourceStart: 24, sourceEnd: 30 });
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("is a no-op (same reference) on slides and near boundaries", () => {
    const withSlide = [slide("s1", 3), clip("a", 0, 10)];
    expect(splitClipAt(withSlide, 1)).toBe(withSlide); // inside the slide
    const items = [clip("a", 0, 10)];
    expect(splitClipAt(items, MIN_ITEM_DURATION / 2)).toBe(items); // sliver
    expect(splitClipAt(items, 10 - MIN_ITEM_DURATION / 2)).toBe(items);
  });
});

describe("removeItem / insertItemAt / boundaryIndexAt", () => {
  it("removes by id", () => {
    expect(removeItem(ITEMS, "a").map((i) => i.id)).toEqual(["s1", "b"]);
  });

  it("inserts at an index", () => {
    const s = slide("s2", 2);
    expect(insertItemAt(ITEMS, 1, s).map((i) => i.id)).toEqual(["s1", "s2", "a", "b"]);
  });

  it("finds the nearest boundary for a timeline time", () => {
    const layout = toLayout(ITEMS); // boundaries at 0, 3, 13, 18
    expect(boundaryIndexAt(layout, 0.4)).toBe(0);
    expect(boundaryIndexAt(layout, 2.9)).toBe(1);
    expect(boundaryIndexAt(layout, 14)).toBe(2);
    expect(boundaryIndexAt(layout, 18)).toBe(3);
  });
});

describe("trimClip", () => {
  it("moves an edge in source time, respecting MIN_ITEM_DURATION", () => {
    const items = [clip("a", 2, 10)];
    expect(trimClip(items, "a", "start", 4)[0]).toMatchObject({ sourceStart: 4 });
    expect(trimClip(items, "a", "end", 8)[0]).toMatchObject({ sourceEnd: 8 });
    // collapsing beyond the minimum clamps instead of inverting
    expect(trimClip(items, "a", "start", 99)[0]).toMatchObject({
      sourceStart: 10 - MIN_ITEM_DURATION,
    });
    expect(trimClip(items, "a", "start", -5)[0]).toMatchObject({ sourceStart: 0 });
  });

  it("clamps the end edge to the end of the clip's range", () => {
    expect(trimClip([clip("a", 0, 30)], "a", "end", 90, { start: 0, end: 60 })[0]).toMatchObject({
      sourceEnd: 60,
    });
  });

  it("start edge stops at the previous clip's end in source, or reclaims a deleted gap", () => {
    expect(trimClip([clip("a", 0, 10), clip("b", 10, 20)], "b", "start", 4)[1]).toMatchObject({
      sourceStart: 10,
    });
    expect(trimClip([clip("a", 0, 5), clip("b", 10, 20)], "b", "start", 4)[1]).toMatchObject({
      sourceStart: 5,
    });
  });

  it("end edge stops at the next clip's start", () => {
    expect(trimClip([clip("a", 0, 10), clip("b", 10, 20)], "a", "end", 15)[0]).toMatchObject({
      sourceEnd: 10,
    });
    expect(trimClip([clip("a", 0, 5), clip("b", 10, 20)], "a", "end", 15)[0]).toMatchObject({
      sourceEnd: 10,
    });
  });

  it("bounds do not depend on item order", () => {
    expect(trimClip([clip("b", 10, 20), clip("a", 0, 10)], "b", "start", 0)[0]).toMatchObject({
      sourceStart: 10,
    });
  });

  it("ignores clips that already overlap (legacy sessions)", () => {
    expect(trimClip([clip("a", 0, 15), clip("b", 10, 20)], "b", "start", 2)[1]).toMatchObject({
      sourceStart: 2,
    });
  });
});

describe("setSlideDuration", () => {
  it("clamps to the minimum duration", () => {
    const items = [slide("s1", 3)];
    expect(setSlideDuration(items, "s1", 0)[0]).toMatchObject({
      duration: MIN_ITEM_DURATION,
    });
    expect(setSlideDuration(items, "s1", 7.5)[0]).toMatchObject({ duration: 7.5 });
  });
});

describe("clampOverlays", () => {
  const overlay = (id: string, start: number, end: number): VideoOverlay => ({
    id,
    kind: "text",
    x: 0.1,
    y: 0.1,
    text: "hola",
    size: 19,
    color: "#000",
    start,
    end,
  });

  it("clamps overlay windows into the new duration and drops orphans", () => {
    const result = clampOverlays(
      [overlay("keep", 1, 5), overlay("clip", 8, 15), overlay("drop", 12, 14)],
      10,
    );
    expect(result.map((o) => o.id)).toEqual(["keep", "clip"]);
    expect(result[1]).toMatchObject({ start: 8, end: 10 });
  });
});

describe("skipTarget", () => {
  // ITEMS lays out as: slide 0–3, clip 3–13, clip 13–18 (total 18 s).
  const layout = toLayout(ITEMS);

  it("skips SKIP_SECONDS (5 s) in either direction", () => {
    expect(SKIP_SECONDS).toBe(5);
    expect(skipTarget(layout, 8, 1, false)).toBe(13);
    expect(skipTarget(layout, 8, -1, false)).toBe(3);
  });

  it("clamps to the start and the end of the timeline", () => {
    expect(skipTarget(layout, 2, -1, false)).toBe(0);
    expect(skipTarget(layout, 16, 1, false)).toBe(18);
  });

  it("with shift, jumps to the next cut boundary after the playhead", () => {
    expect(skipTarget(layout, 0, 1, true)).toBe(3);
    expect(skipTarget(layout, 5, 1, true)).toBe(13);
    expect(skipTarget(layout, 13, 1, true)).toBe(18);
  });

  it("with shift, jumps to the previous cut boundary before the playhead", () => {
    expect(skipTarget(layout, 5, -1, true)).toBe(3);
    expect(skipTarget(layout, 13.5, -1, true)).toBe(13);
    // Standing on a cut goes to the one before it, not to itself.
    expect(skipTarget(layout, 13, -1, true)).toBe(3);
  });

  it("with shift, falls back to the ends when there is no cut left in that direction", () => {
    expect(skipTarget(layout, 17, 1, true)).toBe(18);
    expect(skipTarget(layout, 1, -1, true)).toBe(0);
  });

  it("returns the playhead unchanged on an empty timeline", () => {
    expect(skipTarget([], 0, 1, false)).toBe(0);
    expect(skipTarget([], 0, -1, true)).toBe(0);
  });
});

describe("floating-item anchors", () => {
  // 0–10 s of the recording, a 4 s slide, then 20–30 s of the recording (10–20 s deleted).
  const items: TrackItem[] = [clip("a", 0, 10), slide("s", 4), clip("b", 20, 30)];
  const layout = toLayout(items);

  it("anchors a time inside a clip to the footage under it", () => {
    expect(anchorAt(layout, 3)).toEqual({ kind: "source", time: 3 });
    expect(anchorAt(layout, 16)).toEqual({ kind: "source", time: 22 });
  });

  it("anchors a time inside a slide to that slide and the offset into it", () => {
    expect(anchorAt(layout, 12)).toEqual({ kind: "item", itemId: "s", offset: 2 });
  });

  it("resolves a source anchor to the timeline time of that footage", () => {
    expect(resolveAnchor(layout, { kind: "source", time: 22 })).toBe(16);
  });

  it("resolves an item anchor to the slide start plus its offset, kept inside the slide", () => {
    expect(resolveAnchor(layout, { kind: "item", itemId: "s", offset: 2 })).toBe(12);
    expect(resolveAnchor(layout, { kind: "item", itemId: "s", offset: 99 })).toBe(14);
  });

  it("resolves to null when the footage or the slide is gone", () => {
    expect(resolveAnchor(layout, { kind: "source", time: 15 })).toBeNull();
    expect(resolveAnchor(layout, { kind: "item", itemId: "gone", offset: 0 })).toBeNull();
    expect(resolveAnchor(layout, { kind: "item", itemId: "a", offset: 0 })).toBeNull();
  });

  it("keeps the same second of the recording after an insert before it", () => {
    const anchor = anchorAt(layout, 3);
    const inserted = toLayout([slide("intro", 3), ...items]);
    expect(resolveAnchor(inserted, anchor!)).toBe(6);
  });

  it("resolves the start of a clip to that clip when an earlier clip ends on the same source time", () => {
    // A split at 5 s with a 3 s slide put between the halves: source 5 is the END of the
    // first clip (timeline 5) and the START of the second (timeline 8).
    const apart = toLayout([clip("a", 0, 5), slide("s", 3), clip("b", 5, 10)]);
    expect(resolveAnchor(apart, { kind: "source", time: 5 })).toBe(8);
    expect(resolveAnchor(apart, { kind: "source", time: 2 })).toBe(2);
    expect(resolveAnchor(apart, { kind: "source", time: 7 })).toBe(10);
  });

  it("an anchor on the end of a clip belongs to no clip: the footage under it is gone", () => {
    // Source 10 is where clip a ends, before the deleted 10-20 s gap.
    expect(resolveAnchor(layout, { kind: "source", time: 10 })).toBeNull();
    expect(resolveAnchor(layout, { kind: "source", time: 30 })).toBeNull();
  });

  describe("anchors in a joined recording", () => {
    // A 0–5 s of the opened recording, B 3600–3607 s of the joined one, then A 5–10 s.
    const a = clip("a", 0, 5);
    const b = clip("b", 3600, 3607);
    const a2 = clip("a2", 5, 10);

    it("resolves a source anchor in B to the timeline time of its footage", () => {
      const layout = toLayout([a, b, a2]);
      expect(resolveAnchor(layout, { kind: "source", time: 3602 })).toBe(7);
      expect(resolveAnchor(layout, { kind: "source", time: 2 })).toBe(2);
      expect(resolveAnchor(layout, { kind: "source", time: 5 })).toBe(12);
      // Source 7 is 2 s into A2, which starts at timeline 12 after B's 7 s.
      expect(resolveAnchor(layout, { kind: "source", time: 7 })).toBe(14);
    });

    it("a floating image anchored in a joined recording follows that recording's footage when the clips are reordered", () => {
      const reordered = toLayout([b, a, a2]);
      expect(resolveAnchor(reordered, { kind: "source", time: 3602 })).toBe(2);
      expect(resolveAnchor(reordered, { kind: "source", time: 2 })).toBe(9);
    });

    it("resolves to null in the gap between the recordings and past the end of B", () => {
      const layout = toLayout([a, b, a2]);
      expect(resolveAnchor(layout, { kind: "source", time: 1000 })).toBeNull();
      expect(resolveAnchor(layout, { kind: "source", time: 3607.5 })).toBeNull();
    });
  });

  it("deleting the footage that starts at the anchor drops it, even when the clip before ends there", () => {
    // Clips [0,5) [5,10) [20,30); the image sits at source 5, then the middle clip is deleted.
    const before = toLayout([clip("a", 0, 5), clip("m", 5, 10), clip("b", 20, 30)]);
    const anchor = { kind: "source" as const, time: 5 };
    expect(resolveAnchor(before, anchor)).toBe(5);
    expect(resolveAnchor(toLayout([clip("a", 0, 5), clip("b", 20, 30)]), anchor)).toBeNull();
  });

  it("clamps a time past the end onto the last entry", () => {
    expect(anchorAt(layout, 999)).toEqual({ kind: "source", time: 30 });
  });

  it("is null on an empty layout", () => {
    expect(anchorAt([], 1)).toBeNull();
  });
});

describe("joined recordings on one source axis (ADR 0058)", () => {
  // A is the opened recording [0, 100]; B is joined at [3600, 3620].
  const axis = sourceAxis(100, [
    {
      id: "src-b",
      assetId: "lib-b",
      title: "B",
      offset: 3600,
      durationSeconds: 20,
      width: 0,
      height: 0,
    },
  ]);
  const boundsOf = (items: TrackItem[], id: string) =>
    clipBounds(axis, items.find((i) => i.id === id) as { sourceStart: number });
  // Sequence: A 0–10, B 3605–3615 (trimmed), A 10–20.
  const items = [clip("a1", 0, 10), clip("b", 3605, 3615), clip("a2", 10, 20)];

  it("trimClip stops a joined clip at both ends of its range", () => {
    const b = boundsOf(items, "b");
    expect(trimClip(items, "b", "end", 4000, b)[1]).toMatchObject({ sourceEnd: 3620 });
    expect(trimClip(items, "b", "start", 100, b)[1]).toMatchObject({ sourceStart: 3600 });
  });

  it("trimClip cannot pull a joined clip's start back into A", () => {
    expect(trimClip(items, "b", "start", 20, boundsOf(items, "b"))[1]).toMatchObject({
      sourceStart: 3600,
    });
  });

  it("trimClip keeps A's clips out of B's range", () => {
    expect(trimClip(items, "a2", "end", 3610, boundsOf(items, "a2"))[2]).toMatchObject({
      sourceEnd: 100,
    });
  });

  it("splitting a joined clip leaves both halves inside its range", () => {
    // B plays on the timeline at 10–20; cut at 13 → source 3608.
    const next = splitClipAt(items, 13);
    const halves = next.filter((i) => i.kind === "clip" && i.sourceStart >= 3600) as {
      sourceStart: number;
      sourceEnd: number;
    }[];
    expect(halves.map((h) => [h.sourceStart, h.sourceEnd])).toEqual([
      [3605, 3608],
      [3608, 3615],
    ]);
    for (const h of halves) {
      expect(h.sourceStart).toBeGreaterThanOrEqual(3600);
      expect(h.sourceEnd).toBeLessThanOrEqual(3620);
    }
  });

  it("reordering and deleting keep a joined clip's source range unchanged", () => {
    const moved = insertItemAt(removeItem(items, "b"), 0, items[1]);
    expect(moved.map((i) => i.id)).toEqual(["b", "a1", "a2"]);
    expect(moved[0]).toMatchObject({ sourceStart: 3605, sourceEnd: 3615 });
    expect(removeItem(items, "b").map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("a source anchor inside B's range follows B's clip after a reorder", () => {
    const anchor = { kind: "source" as const, time: 3607 };
    expect(resolveAnchor(toLayout(items), anchor)).toBeCloseTo(12);
    const reordered = [items[1], items[0], items[2]];
    expect(resolveAnchor(toLayout(reordered), anchor)).toBeCloseTo(2);
  });

  it("a source anchor inside B's range resolves to null once B's clip is deleted", () => {
    expect(
      resolveAnchor(toLayout(removeItem(items, "b")), { kind: "source", time: 3607 }),
    ).toBeNull();
  });

  it("an anchor on A does not follow B", () => {
    expect(
      resolveAnchor(toLayout(removeItem(items, "b")), { kind: "source", time: 12 }),
    ).toBeCloseTo(12);
  });
});
