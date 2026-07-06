/**
 * Rebases a decoded video frame's source timestamp onto the export's output
 * (collapsed) timeline, guarding the two failure modes `CanvasSink.canvases(start, end)`
 * creates around a trim/cut boundary:
 *
 * 1. mediabunny's `canvases(start, end)` yields the sample STRADDLING `start` as its
 *    first frame — that frame's own `timestamp` is usually LESS than `start` for any
 *    non-frame-aligned trim. Naively rebasing
 *    `segmentTimelineStart + (frameTimestamp - segmentSourceStart)` then produces a
 *    negative output timestamp for a segment whose `timelineStart` is 0 (a trimmed
 *    or split-and-deleted head), which `CanvasSource.add` rejects outright.
 * 2. The same straddling frame can also rebase to a timestamp at or before the
 *    previous segment's last emitted frame at a cut boundary, which would hand the
 *    muxer non-monotonic timestamps.
 *
 * Clamping keeps the value at least `segmentTimelineStart`; when the clamped value
 * would not strictly advance past `prevOutTs`, the frame is dropped (returns `null`)
 * rather than emitted, which is what keeps every timestamp handed to
 * `CanvasSource.add` strictly increasing across segment boundaries.
 */
export function rebaseVideoTimestamp(
  segmentTimelineStart: number,
  segmentSourceStart: number,
  frameTimestamp: number,
  prevOutTs: number | null,
): number | null {
  const raw = segmentTimelineStart + (frameTimestamp - segmentSourceStart);
  const clamped = Math.max(segmentTimelineStart, raw);
  if (prevOutTs !== null && clamped <= prevOutTs) return null;
  return clamped;
}
