/**
 * Pure planning for a still capture (NIW2-764): which timeline time the frame is taken at,
 * what is on screen there (a clip or a slide) and, for a clip, the SOURCE time. The frame
 * itself is composed by `gif-worker.ts` in "still" mode through the same composer the
 * exports use, so a capture and an export of the same time never differ.
 */
import { placeMedia } from "../media";
import type { VideoScene } from "../scene";
import { buildExportPlan, locateTimelineTime, type ExportPlan } from "./export-plan";

/**
 * A playhead resting on the very end of the timeline lies past the last frame's span; the
 * decoder then returns nothing. The capture is taken this far before the end instead
 * (under one frame at 30 fps and above).
 */
export const STILL_END_MARGIN_S = 1 / 120;

export interface StillPlan {
  /** The whole (unsliced) plan: redactions, overlay windows, webcam and background included. */
  plan: ExportPlan;
  /** Timeline time of the captured frame, the playhead clamped into the timeline. */
  timelineSeconds: number;
  /** Source video time of that frame; null on a slide. */
  sourceSeconds: number | null;
  kind: "clip" | "slide";
}

export function planStill(scene: VideoScene, playheadSeconds: number): StillPlan {
  // Throws on an empty timeline: there is nothing to capture.
  const plan = buildExportPlan(scene);
  const latest = Math.max(0, plan.totalDuration - STILL_END_MARGIN_S);
  const requested = Number.isFinite(playheadSeconds) ? playheadSeconds : 0;
  const timelineSeconds = Math.min(Math.max(0, requested), latest);
  const located = locateTimelineTime(plan, timelineSeconds);
  if (!located) throw new Error(`no segment at ${timelineSeconds}`);
  const isClip = located.segment.kind === "clip";
  if (plan.floating) {
    // One frame is drawn: only the floating images on screen at it are decoded and sent.
    const { items, layout, timeOffset } = plan.floating;
    const at = timelineSeconds + timeOffset;
    const kept = placeMedia(items, layout)
      .filter((p) => p.start <= at && at < p.end)
      .map((p) => p.item);
    if (kept.length > 0) plan.floating = { items: kept, layout, timeOffset };
    else delete plan.floating;
  }
  return {
    plan,
    timelineSeconds,
    sourceSeconds: isClip ? located.sourceTime : null,
    kind: isClip ? "clip" : "slide",
  };
}
