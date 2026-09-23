/**
 * Pure export plan — folds the edited scene into the ordered render segments and
 * overlay stamping windows the export worker (Task 3) consumes verbatim. Built on
 * `toLayout`/`layoutDuration` (timeline.ts) so export and preview never disagree
 * about timeline↔source mapping — see that module's header comment.
 */
import { layoutDuration, toLayout } from "../timeline";
import type { VideoScene } from "../scene";
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
  };
}
