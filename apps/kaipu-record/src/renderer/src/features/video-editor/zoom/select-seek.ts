/**
 * Where to seek (if anywhere) when a zoom segment is selected from the timeline.
 *
 * Why: `handleSelectZoom` used to seek unconditionally to the segment's middle. If the
 * user had scrubbed to a specific frame while positioning the camera box, that frame
 * was lost the moment they clicked the segment's own timeline block — the box would
 * re-draw for a different instant (backlog/video-editor-camera-box-ux § 2, candidate
 * cause A). The fix: seek only when the playhead is currently OUTSIDE the segment's
 * timeline range; when it is already inside, keep the user's frame untouched.
 */
import { sourceRangeToTimelineBlocks, type TimelineBlock } from "../source-time";
import type { LayoutEntry } from "../timeline";

function containsInclusive(block: TimelineBlock, t: number): boolean {
  // Inclusive on both ends: a playhead sitting exactly on a block boundary (e.g. the
  // seam between two blocks produced by a cut) counts as "inside" that block, so a
  // click there never re-seeks either. Matches entryAt/timelineToSource's own
  // boundary handling in timeline.ts.
  return t >= block.timelineStart && t <= block.timelineEnd;
}

/**
 * Seek target for selecting `segment` from the timeline while the playhead is at
 * `timelineTime`. Returns `null` when the caller should NOT seek (the playhead already
 * sits inside one of the segment's visible blocks), otherwise the center of the first
 * block — the same target the page computed unconditionally before this fix. Also
 * returns `null` when the segment is fully cut away (no visible blocks).
 */
export function seekTargetForSegment(
  layout: LayoutEntry[],
  timelineTime: number,
  segment: { start: number; end: number },
): number | null {
  const blocks = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
  if (blocks.some((block) => containsInclusive(block, timelineTime))) return null;
  const [first] = blocks;
  return first ? (first.timelineStart + first.timelineEnd) / 2 : null;
}
