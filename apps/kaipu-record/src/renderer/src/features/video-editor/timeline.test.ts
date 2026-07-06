import { describe, expect, it } from "vitest";
import type { TrackItem, VideoOverlay } from "./scene";
import {
  boundaryIndexAt,
  clampOverlays,
  entryAt,
  insertItemAt,
  layoutDuration,
  MIN_ITEM_DURATION,
  removeItem,
  setSlideDuration,
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
