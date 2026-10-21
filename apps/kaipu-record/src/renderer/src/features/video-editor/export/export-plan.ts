/**
 * Pure export plan — folds the edited scene into the ordered render segments and
 * overlay stamping windows the export worker (Task 3) consumes verbatim. Built on
 * `toLayout`/`layoutDuration` (timeline.ts) so export and preview never disagree
 * about timeline↔source mapping — see that module's header comment.
 */
import { layoutDuration, toLayout } from "../timeline";
import type { VideoScene } from "../scene";
import type { AudioEdits } from "../audio-edits";
import type { Redaction } from "../privacy/redaction";
import { isSourceRangeVisible } from "../source-time";

export interface RenderClipSegment {
  kind: "clip";
  timelineStart: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface RenderSlideSegment {
  kind: "slide";
  timelineStart: number;
  duration: number;
  assetId: string;
}

export type RenderSegment = RenderClipSegment | RenderSlideSegment;

export interface OverlayWindow {
  overlayId: string;
  start: number;
  end: number;
}

export interface ExportPlan {
  /** Ordered, contiguous, timelineStart ascending. */
  segments: RenderSegment[];
  /** Stamping order = scene order (draw order). */
  overlayWindows: OverlayWindow[];
  totalDuration: number;
  slideFps: 30;
  /**
   * v2: privacy regions (SOURCE time) that are visible somewhere on the timeline. The
   * worker selects per frame by interval overlap (redactionsForFrame).
   */
  redactions: Redaction[];
  /** v2: true when the scene has ANY zoom — the renderer then sends the camera path. */
  hasZoom: boolean;
  /**
   * The audio half of the scene, carried through untouched so the worker can
   * decide per segment what to copy and what to zero. `audioMuted` makes the
   * worker skip the audio track entirely rather than write a silent one.
   */
  audio: AudioEdits;
}

export function buildExportPlan(scene: VideoScene): ExportPlan {
  const layout = toLayout(scene.items);
  // The UI disables the Exportar action when the timeline is empty; this throw is
  // just a backstop so the worker never starts an export with nothing to encode.
  if (layout.length === 0) throw new Error("empty timeline");

  const segments: RenderSegment[] = layout.map((entry) =>
    entry.kind === "clip"
      ? {
          kind: "clip",
          timelineStart: entry.timelineStart,
          duration: entry.timelineEnd - entry.timelineStart,
          sourceStart: entry.sourceStart,
          sourceEnd: entry.sourceEnd,
        }
      : {
          kind: "slide",
          timelineStart: entry.timelineStart,
          duration: entry.timelineEnd - entry.timelineStart,
          // Layout guarantees `assetId` is set on every slide entry.
          assetId: entry.assetId!,
        },
  );

  const overlayWindows: OverlayWindow[] = scene.overlays.map((overlay) => ({
    overlayId: overlay.id,
    start: overlay.start,
    end: overlay.end,
  }));

  return {
    segments,
    overlayWindows,
    totalDuration: layoutDuration(layout),
    slideFps: 30,
    redactions: scene.redactions.filter((r) => isSourceRangeVisible(layout, r.start, r.end)),
    // NOT filtered by visibility, unlike the redactions: the camera has 0.2 s of lookahead
    // and eases out past a segment's end, so a zoom sitting entirely in deleted footage
    // still moves the camera over the kept frames next to the cut — exactly as the preview
    // renders it. Dropping the path here would silently un-zoom those frames.
    hasZoom: scene.zoomSegments.length > 0,
    // Not filtered by visibility either: a range is clipped to each segment at
    // write time, so one sitting in deleted footage costs nothing and survives
    // an undo of the cut.
    audio: { audioMuted: scene.audioMuted, mutedRanges: scene.mutedRanges },
  };
}

/**
 * The part of `plan` inside the timeline range [start, end), rebased so the range starts at
 * 0 (NIW2-217, GIF range export). Segments are clipped (a clip's source window moves with
 * its timeline window), overlay windows are clipped to the range, and everything that is in
 * SOURCE time — redactions, the camera path, audio edits — is carried through unchanged.
 */
export function sliceExportPlan(plan: ExportPlan, start: number, end: number): ExportPlan {
  const from = Math.max(0, Math.min(start, plan.totalDuration));
  const to = Math.max(from, Math.min(end, plan.totalDuration));
  const segments: RenderSegment[] = [];
  for (const segment of plan.segments) {
    const segEnd = segment.timelineStart + segment.duration;
    const s = Math.max(segment.timelineStart, from);
    const e = Math.min(segEnd, to);
    if (e <= s) continue;
    const timelineStart = s - from;
    const duration = e - s;
    if (segment.kind === "clip") {
      const sourceStart = segment.sourceStart + (s - segment.timelineStart);
      segments.push({
        kind: "clip",
        timelineStart,
        duration,
        sourceStart,
        sourceEnd: sourceStart + duration,
      });
    } else {
      segments.push({ kind: "slide", timelineStart, duration, assetId: segment.assetId });
    }
  }
  const overlayWindows = plan.overlayWindows
    .filter((w) => w.end >= from && w.start <= to)
    .map((w) => ({
      overlayId: w.overlayId,
      start: Math.max(w.start, from) - from,
      end: Math.min(w.end, to) - from,
    }));
  return { ...plan, segments, overlayWindows, totalDuration: to - from };
}

export interface GifFrameSlot {
  /** Timeline time of the frame (seconds, from the range start). */
  t: number;
  /** How long the frame stays on screen, in GIF centiseconds. */
  delayCs: number;
}

/**
 * Fixed-cadence GIF frame times for a range of `duration` seconds at `fps` (FR 5). Delays
 * are whole centiseconds distributed with a running remainder, so their sum stays within
 * one frame of the range: 15 fps → 7/7/6 cs, 10 fps → 10 cs.
 */
export function gifFrameSchedule(duration: number, fps: number): GifFrameSlot[] {
  const count = Math.max(1, Math.round(duration * fps));
  const slots: GifFrameSlot[] = [];
  // ceil(x - ε): the running total of exact centiseconds, rounded up, minus what was spent.
  const cumulative = (i: number): number => Math.ceil((i * 100) / fps - 1e-9);
  for (let i = 0; i < count; i++) {
    slots.push({ t: i / fps, delayCs: cumulative(i + 1) - cumulative(i) });
  }
  return slots;
}

/** Where timeline time `t` lands: the segment and, for a clip, the source time. */
export function locateTimelineTime(
  plan: ExportPlan,
  t: number,
): { segment: RenderSegment; sourceTime: number } | null {
  const segments = plan.segments;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const end = segment.timelineStart + segment.duration;
    const last = i === segments.length - 1;
    if (t >= segment.timelineStart && (t < end || (last && t <= end))) {
      const sourceTime =
        segment.kind === "clip"
          ? Math.min(segment.sourceEnd, segment.sourceStart + (t - segment.timelineStart))
          : 0;
      return { segment, sourceTime };
    }
  }
  return null;
}

/**
 * GIF output size (FR 2–3): `width` capped at the source width, height from the source
 * (= edited timeline) aspect ratio, both rounded to even numbers.
 */
export function gifOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
): { width: number; height: number } {
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
  const w = even(Math.min(width, sourceWidth));
  return { width: w, height: even((w * sourceHeight) / sourceWidth) };
}

/** Why a GIF range can't be exported (FR 7), or null when it can. */
export function gifRangeProblem(
  start: number,
  end: number,
  limits: { min: number; max: number },
): "too-short" | "too-long" | null {
  const duration = end - start;
  // A few ms of slack so a 30.000 s range typed by hand is not refused for float noise.
  if (duration < limits.min - 1e-6) return "too-short";
  if (duration > limits.max + 1e-6) return "too-long";
  return null;
}
