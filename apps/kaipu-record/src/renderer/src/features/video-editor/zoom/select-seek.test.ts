import { describe, expect, it } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { seekTargetForSegment } from "./select-seek";

// Same fixture shape as source-time.test.ts: source 0–30 s, with 10–15 s deleted and a
// 3 s slide inserted between the pieces (timeline: clip a 0–10, slide 10–13, clip b
// 13–28, backed by source 15–30).
const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
  { id: "s", kind: "slide", assetId: "img", duration: 3, naturalWidth: 10, naturalHeight: 10 },
  { id: "b", kind: "clip", sourceStart: 15, sourceEnd: 30 },
];
const layout = toLayout(items);

describe("seekTargetForSegment", () => {
  it("does not seek when the playhead is already inside the (single-block) segment", () => {
    // source [2, 4) -> one block at timeline [2, 4]
    expect(seekTargetForSegment(layout, 3, { start: 2, end: 4 })).toBeNull();
  });

  it("seeks to the block's center when the playhead is before it", () => {
    expect(seekTargetForSegment(layout, 0, { start: 2, end: 4 })).toBe(3);
  });

  it("seeks to the block's center when the playhead is after it", () => {
    expect(seekTargetForSegment(layout, 9, { start: 2, end: 4 })).toBe(3);
  });

  it("does not seek when the playhead is inside the SECOND block of a split segment", () => {
    // source [8, 17) splits across the cut into blocks [8, 10] and [13, 15]
    expect(seekTargetForSegment(layout, 14, { start: 8, end: 17 })).toBeNull();
  });

  it("seeks to the first block's center when the playhead sits in the gap between blocks", () => {
    // gap is the slide, timeline (10, 13)
    expect(seekTargetForSegment(layout, 11, { start: 8, end: 17 })).toBe(9);
  });

  it("does not seek when the segment is fully cut away (no visible blocks)", () => {
    // source [11, 14) lies entirely in the deleted 10-15s footage
    expect(seekTargetForSegment(layout, 5, { start: 11, end: 14 })).toBeNull();
  });
});
