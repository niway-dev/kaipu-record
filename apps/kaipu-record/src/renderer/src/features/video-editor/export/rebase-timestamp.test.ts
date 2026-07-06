import { describe, expect, it } from "vitest";
import { rebaseVideoTimestamp } from "./rebase-timestamp";

describe("rebaseVideoTimestamp", () => {
  it("passes a normal in-range frame through unchanged", () => {
    // segment starts at timeline 3, source 0..10; a frame at source ts 2 lands at
    // timeline 5, well past both the segment start and the previous frame's ts.
    expect(rebaseVideoTimestamp(3, 0, 2, 4)).toBe(5);
  });

  it("clamps a pre-sourceStart straddle frame to the segment's timelineStart instead of going negative", () => {
    // CanvasSink.canvases(sourceStart, ...) yields the straddling frame first, whose
    // own timestamp can be before sourceStart for a non-frame-aligned trim — e.g.
    // sourceStart=1.2 but the frame actually starts at 1.0. On a first timeline
    // segment (timelineStart=0) the naive rebase would be 0 + (1.0 - 1.2) = -0.2.
    expect(rebaseVideoTimestamp(0, 1.2, 1.0, null)).toBe(0);
  });

  it("drops a boundary frame that would regress at or below the previous emitted timestamp", () => {
    // prevOutTs already sits at 5; a straddle frame rebasing to 4.9 (or exactly 5)
    // must not be handed to the muxer — it would be non-monotonic or a duplicate.
    expect(rebaseVideoTimestamp(5, 5, 4.9, 5)).toBeNull();
    expect(rebaseVideoTimestamp(5, 5, 5, 5)).toBeNull();
  });

  it("preserves a strictly-increasing sequence across several frames", () => {
    let prev: number | null = null;
    const frameTimestamps = [0, 1 / 30, 2 / 30, 3 / 30];
    const outputs: number[] = [];
    for (const ts of frameTimestamps) {
      const outTs = rebaseVideoTimestamp(0, 0, ts, prev);
      expect(outTs).not.toBeNull();
      outputs.push(outTs!);
      prev = outTs;
    }
    expect(outputs).toEqual(frameTimestamps);
  });

  it("returns null (not a negative-adjacent clamp) when a straddle frame is exactly at the previous timestamp", () => {
    // Guards the degenerate case where the clamp lands exactly on prevOutTs rather
    // than merely close to it — still must be treated as non-advancing.
    expect(rebaseVideoTimestamp(2, 2, 1.9, 2)).toBeNull();
  });
});
