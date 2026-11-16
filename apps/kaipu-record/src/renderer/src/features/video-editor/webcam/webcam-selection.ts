/**
 * What a webcam selection means for the preview and the inspector (ADR 0038). Pure, so the
 * page's two rules are pinned by tests instead of living inline in JSX.
 */
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import {
  sourceRangeToTimelineBlocks,
  sourceTimeAtTimeline,
  timelineTimeAtSource,
} from "../source-time";
import type { LayoutEntry } from "../timeline";
import { seekTargetForSegment } from "../zoom/select-seek";
import { webcamOverrideAt, type WebcamScene, type WebcamSegment } from "./webcam-model";
import { webcamPartSlideSeconds } from "./webcam-stretches";

/**
 * Whether the preview outlines the bubble: for the layer and for an override (both are the
 * bubble's look), not for a hidden range, which has nothing on screen to outline.
 */
export function webcamOutlined(webcam: WebcamScene, selectedId: string | null): boolean {
  if (selectedId === WEBCAM_LAYER_SELECTION) return true;
  return webcam.segments.some((s) => s.id === selectedId && s.mode === "override");
}

export type WebcamInspectorTarget = { kind: "layer" } | { kind: "segment"; segment: WebcamSegment };

/**
 * What the inspector edits. A selected segment is itself. The layer is the global layout —
 * except while the playhead (`playheadSource`, null over a slide) sits inside a visible
 * override: the preview shows that override there, so the inspector edits it too, the same
 * rule a drag of the bubble follows.
 */
export function webcamInspectorTarget(
  webcam: WebcamScene,
  visibleSegments: WebcamSegment[],
  selectedId: string | null,
  playheadSource: number | null,
): WebcamInspectorTarget | null {
  if (selectedId === null) return null;
  if (selectedId !== WEBCAM_LAYER_SELECTION) {
    const segment = visibleSegments.find((s) => s.id === selectedId);
    return segment ? { kind: "segment", segment } : null;
  }
  const override = webcamOverrideAt(webcam, playheadSource);
  return override && visibleSegments.includes(override)
    ? { kind: "segment", segment: override }
    : { kind: "layer" };
}

/** The playhead lands this far (seconds) past the end of a part's slide: settled, not at the edge. */
const PAST_SLIDE_SECONDS = 0.1;

/**
 * Where the playhead goes (timeline seconds), if anywhere, when a stretch is selected on the
 * Camera lane. A part: just past its slide, so the preview shows the bubble settled in the
 * part's place; it stays put when it already sits in the part past the slide, so a frame the
 * user scrubbed to is not thrown away. A hidden range: the zoom lane's rule, the middle of its
 * first visible piece unless the playhead is already inside it. When the moment past a part's
 * slide was cut out, the first footage of the part that survives past the slide; a part with
 * none left falls back to the hidden range's rule. Null when the stretch is cut away entirely or no move is
 * needed.
 */
export function webcamSelectSeekTarget(
  layout: LayoutEntry[],
  timelineTime: number,
  segment: WebcamSegment,
): number | null {
  if (segment.mode === "hidden") return seekTargetForSegment(layout, timelineTime, segment);
  const slide = webcamPartSlideSeconds(segment) ?? 0;
  const settled = Math.min(segment.start + slide + PAST_SLIDE_SECONDS, segment.end - 0.01);
  const now = sourceTimeAtTimeline(layout, timelineTime);
  if (now !== null && now >= settled && now < segment.end) return null;
  const settledAt = timelineTimeAtSource(layout, settled);
  if (settledAt !== null) return settledAt;
  // Just past the slide is cut out: the first footage of the part that survives, still past
  // the slide, shows the bubble settled. Only a part with none left falls back to the zoom
  // lane's rule (the middle of its first visible piece).
  const [firstSettled] = sourceRangeToTimelineBlocks(layout, settled, segment.end);
  return firstSettled?.timelineStart ?? seekTargetForSegment(layout, timelineTime, segment);
}

/** "Play the slide" starts this far (seconds) before the part, so the bubble is seen waiting. */
const SLIDE_LEAD_SECONDS = 0.5;

/**
 * Where the playhead goes (timeline seconds) for "Play the slide": a little before the part,
 * so the slide plays from the bubble's old place. When that moment was cut out of the timeline
 * it is the part's own start, and so is a moment that the timeline plays after the part
 * (reordered clips); null when neither is on the timeline.
 */
export function webcamPlaySlideTarget(
  layout: LayoutEntry[],
  segment: WebcamSegment,
): number | null {
  const lead = Math.max(0, segment.start - SLIDE_LEAD_SECONDS);
  const start = timelineTimeAtSource(layout, segment.start);
  const leadAt = timelineTimeAtSource(layout, lead);
  // Reordered clips can put the lead after the part in timeline order; playing from there
  // would run on to the end without showing the slide, so the part's own start is used.
  if (leadAt !== null && (start === null || leadAt <= start)) return leadAt;
  return start;
}
