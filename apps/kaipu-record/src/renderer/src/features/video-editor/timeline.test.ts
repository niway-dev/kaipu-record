import { describe, expect, it } from "vitest";
import type { TrackItem } from "./scene";
import { entryAt, layoutDuration, sourceToTimeline, timelineToSource, toLayout } from "./timeline";

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
