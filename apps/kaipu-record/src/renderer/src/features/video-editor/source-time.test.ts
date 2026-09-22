import { describe, expect, it } from "vitest";
import type { TrackItem } from "./scene";
import { toLayout } from "./timeline";
import {
  dragRangeEdge,
  freeWindowAt,
  isSourceRangeVisible,
  sourceRangeToTimelineBlocks,
  sourceTimeAtTimeline,
} from "./source-time";

// Source 0–30 s, with 10–15 s deleted and a 3 s slide inserted between the pieces.
const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
  { id: "s", kind: "slide", assetId: "img", duration: 3, naturalWidth: 10, naturalHeight: 10 },
  { id: "b", kind: "clip", sourceStart: 15, sourceEnd: 30 },
];
const layout = toLayout(items);

describe("sourceRangeToTimelineBlocks", () => {
  it("maps a range inside one clip", () => {
    expect(sourceRangeToTimelineBlocks(layout, 2, 4)).toEqual([
      { itemId: "a", timelineStart: 2, timelineEnd: 4, sourceStart: 2, sourceEnd: 4 },
    ]);
  });
  it("splits a range across a cut into two blocks", () => {
    expect(sourceRangeToTimelineBlocks(layout, 8, 17)).toEqual([
      { itemId: "a", timelineStart: 8, timelineEnd: 10, sourceStart: 8, sourceEnd: 10 },
      { itemId: "b", timelineStart: 13, timelineEnd: 15, sourceStart: 15, sourceEnd: 17 },
    ]);
  });
  it("hides a range entirely in deleted footage", () => {
    expect(isSourceRangeVisible(layout, 11, 14)).toBe(false);
  });
});

describe("sourceTimeAtTimeline", () => {
  it("maps clips and returns null over slides", () => {
    expect(sourceTimeAtTimeline(layout, 5)).toBe(5);
    expect(sourceTimeAtTimeline(layout, 11)).toBeNull();
    expect(sourceTimeAtTimeline(layout, 14)).toBe(16);
  });
});

describe("dragRangeEdge", () => {
  const ranges = [
    { id: "x", start: 2, end: 5 },
    { id: "y", start: 8, end: 12 },
  ];
  it("stops at the neighbour", () => {
    expect(dragRangeEdge(ranges, "y", "start", 3, 30, 1)).toEqual({ start: 5, end: 12 });
    expect(dragRangeEdge(ranges, "x", "end", 10, 30, 1)).toEqual({ start: 2, end: 8 });
  });
  it("keeps the minimum length", () => {
    expect(dragRangeEdge(ranges, "x", "start", 4.9, 30, 1)).toEqual({ start: 4, end: 5 });
    expect(dragRangeEdge(ranges, "y", "end", 8.2, 30, 1)).toEqual({ start: 8, end: 9 });
  });
  it("stays inside the source", () => {
    expect(dragRangeEdge(ranges, "x", "start", -3, 30, 1)).toEqual({ start: 0, end: 5 });
    expect(dragRangeEdge(ranges, "y", "end", 99, 30, 1)).toEqual({ start: 8, end: 30 });
  });
});

describe("freeWindowAt", () => {
  const ranges = [{ id: "x", start: 5, end: 8 }];
  it("fits before the next range", () => {
    expect(freeWindowAt(ranges, 3, 3, 30, 1)).toEqual({ start: 3, end: 5 });
  });
  it("refuses inside a range or when less than the minimum fits", () => {
    expect(freeWindowAt(ranges, 6, 3, 30, 1)).toBeNull();
    expect(freeWindowAt(ranges, 4.5, 3, 30, 1)).toBeNull();
  });
});
