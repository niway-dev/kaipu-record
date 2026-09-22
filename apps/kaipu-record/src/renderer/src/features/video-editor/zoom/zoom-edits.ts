/**
 * Pure scene edits for zoom segments. Every edit a USER makes to a segment flips it to
 * `origin: "manual"`, so a later Sensitivity change / Re-analyse never overwrites it
 * (replaceAutoSegments keeps manual segments). Detection itself never goes through here.
 */
import type { CursorTrack } from "@shared/cursor-track";
import { newId, type VideoScene } from "../scene";
import { dragRangeEdge } from "../source-time";
import { clampAnchor } from "./camera-path";
import { DETECTION, detectZoomSegments, replaceAutoSegments } from "./detect-zoom-segments";
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom-model";

/**
 * `start`/`end` are deliberately NOT patchable: a zoom's times have to respect its
 * neighbours, the source bounds and `ZOOM_LIMITS.minSeconds`, which only
 * `dragZoomEdge` knows how to enforce.
 */
export type ZoomPatch = Partial<Pick<ZoomSegment, "scale" | "mode" | "anchor" | "smoothing">>;

export function updateZoom(scene: VideoScene, id: string, patch: ZoomPatch): VideoScene {
  return {
    ...scene,
    zoomSegments: scene.zoomSegments
      .map((s) => {
        if (s.id !== id) return s;
        const next: ZoomSegment = { ...s, ...patch, origin: "manual" };
        next.scale = Math.min(ZOOM_LIMITS.maxScale, Math.max(ZOOM_LIMITS.minScale, next.scale));
        next.smoothing = Math.min(100, Math.max(0, Math.round(next.smoothing)));
        // A fixed segment always has an anchor that keeps its window inside the frame.
        if (next.mode === "fixed")
          next.anchor = clampAnchor(next.anchor ?? { x: 0.5, y: 0.5 }, next.scale);
        return next;
      })
      .sort((a, b) => a.start - b.start),
  };
}

/**
 * Timeline edge drag (doc 08 calls this, never `updateZoom`). Delegates the clamping to
 * `dragRangeEdge` (doc 06) so zooms and redactions obey one rule: stay inside
 * [0, sourceDuration], keep `ZOOM_LIMITS.minSeconds`, never cross a neighbouring zoom.
 */
export function dragZoomEdge(
  scene: VideoScene,
  id: string,
  edge: "start" | "end",
  to: number,
  sourceDurationSeconds: number,
): VideoScene {
  if (!scene.zoomSegments.some((s) => s.id === id)) return scene;
  const { start, end } = dragRangeEdge(
    scene.zoomSegments,
    id,
    edge,
    to,
    sourceDurationSeconds,
    ZOOM_LIMITS.minSeconds,
  );
  return {
    ...scene,
    zoomSegments: scene.zoomSegments
      .map((s) => (s.id === id ? { ...s, start, end, origin: "manual" as const } : s))
      .sort((a, b) => a.start - b.start),
  };
}

/** Dragging the camera box: lock the segment where it was dropped (see doc 05). */
export function lockZoomAt(
  scene: VideoScene,
  id: string,
  center: { x: number; y: number },
): VideoScene {
  return updateZoom(scene, id, { mode: "fixed", anchor: center });
}

export function removeZoom(scene: VideoScene, id: string): VideoScene {
  return { ...scene, zoomSegments: scene.zoomSegments.filter((s) => s.id !== id) };
}

export function addManualZoom(
  scene: VideoScene,
  window: { start: number; end: number },
): {
  scene: VideoScene;
  id: string;
} {
  const segment: ZoomSegment = {
    id: newId(),
    start: window.start,
    end: window.end,
    scale: DETECTION.clickScale,
    mode: "follow",
    anchor: null,
    smoothing: ZOOM_DEFAULTS.smoothing,
    origin: "manual",
    trigger: null,
  };
  return {
    scene: {
      ...scene,
      zoomSegments: [...scene.zoomSegments, segment].sort((a, b) => a.start - b.start),
    },
    id: segment.id,
  };
}

function sameSegment(a: ZoomSegment, b: ZoomSegment): boolean {
  return (
    a.id === b.id &&
    a.start === b.start &&
    a.end === b.end &&
    a.scale === b.scale &&
    a.mode === b.mode &&
    a.smoothing === b.smoothing &&
    a.origin === b.origin &&
    a.trigger === b.trigger &&
    (a.anchor?.x ?? null) === (b.anchor?.x ?? null) &&
    (a.anchor?.y ?? null) === (b.anchor?.y ?? null)
  );
}

/** Sensitivity slider / Re-analyse: regenerate the auto segments, keep the manual ones. */
export function applySensitivity(
  scene: VideoScene,
  track: CursorTrack,
  sourceDurationSeconds: number,
  sensitivity: number,
): VideoScene {
  const s = Math.min(100, Math.max(0, Math.round(sensitivity)));
  const zoomSegments = replaceAutoSegments(
    scene.zoomSegments,
    detectZoomSegments(track, sourceDurationSeconds, s),
  );
  // A Re-analyse that changes nothing — or a slider dragged back to where it started —
  // must return the SAME object: `commit` and `endInteract` no-op on reference equality,
  // so no undo step is pushed, the editor does not go dirty and the autosave stays quiet.
  if (
    s === scene.zoomSensitivity &&
    zoomSegments.length === scene.zoomSegments.length &&
    zoomSegments.every((z, i) => sameSegment(z, scene.zoomSegments[i]))
  ) {
    return scene;
  }
  return { ...scene, zoomSensitivity: s, zoomSegments };
}
