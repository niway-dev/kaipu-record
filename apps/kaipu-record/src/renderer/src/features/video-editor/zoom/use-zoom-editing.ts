/**
 * Zoom editing handlers for the editor page, following the scene-history contract of
 * plans/video-editor-v2/07: discrete actions commit; continuous gestures (sliders, edge
 * drags, camera-box drag) run begin → live… → end.
 *
 * Every handler reads `controller.scene` — the scene as of the last render. That is NOT
 * useVideoScene's private `sceneRef` (the ref is what makes endInteract's comparison
 * exact and is not exposed), but it is correct here because each pointer/change event
 * flushes its own render before the next one arrives, so a live handler always sees the
 * result of the previous live update. (Edge drags are the exception: their live update runs in
 * an animation frame, so the render behind it can still be pending when the next event lands;
 * `lastEdgeScene` below is the scene they last applied, and they read that instead.) What must never happen is closing over a `scene`
 * captured in the page's render body and kept across renders — hence `controller` in
 * every dependency array.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLatest } from "../use-latest";
import { clipBounds, type SourceAxis } from "../source-axis";
import { freeWindowAt, isSourceRangeVisible, sourceTimeAtTimeline } from "../source-time";
import type { LayoutEntry } from "../timeline";
import type { VideoScene } from "../scene";
import type { RecordingZoomInput } from "./recording-zooms";
import type { VideoSceneController } from "../use-video-scene";
import {
  addManualZoom,
  applySensitivityToRecordings,
  dragZoomEdge,
  lockZoomAt,
  removeZoom,
  updateZoom,
  type ZoomPatch,
} from "./zoom-edits";
import { ZOOM_LIMITS, type ZoomSegment } from "./zoom-model";

export type AddZoomResult =
  | { ok: true; id: string }
  | { ok: false; reason: "on-slide" | "no-room" | "busy" };

export interface ZoomEditing {
  /** Segments with at least one visible piece — what the lane, counts and inspector use. */
  visibleZooms: ZoomSegment[];
  /** Fraction (0–1) of the TIMELINE covered by visible zoom pieces, for the Detection summary. */
  coverage: number;
  addAtPlayhead(timelineTime: number): AddZoomResult;
  remove(id: string): void;
  commitPatch(id: string, patch: ZoomPatch): void;
  begin(): void;
  livePatch(id: string, patch: ZoomPatch): void;
  end(): void;
  /** Zoom lane edge drag — same phase contract as the overlay lane. */
  edgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
  /** Camera-box drag in the preview: locks the segment at `center` (doc 05). */
  liveLock(id: string, center: { x: number; y: number }): void;
  /**
   * What the Detection summary would read at `value`, without touching the scene. The
   * Sensitivity drag shows this while the pointer is down and applies once on release,
   * so a long recording's ~100 zooms are not rebuilt on every move (NIW2-672).
   */
  sensitivityPreview(value: number): { count: number; coverage: number };
  sensitivityCommit(value: number): void;
  reanalyse(): void;
  /** False when the recording has no cursor track (Detection panel shows its empty state). */
  canDetect: boolean;
}

/** Fraction (0–1) of the TIMELINE covered by zoom pieces inside clips. */
function coverageOf(
  segments: ZoomSegment[],
  layout: LayoutEntry[],
  timelineDuration: number,
): number {
  if (timelineDuration <= 0) return 0;
  let covered = 0;
  for (const entry of layout) {
    if (entry.kind !== "clip") continue;
    for (const z of segments) {
      covered += Math.max(
        0,
        Math.min(z.end, entry.sourceEnd) - Math.max(z.start, entry.sourceStart),
      );
    }
  }
  return Math.min(1, covered / timelineDuration);
}

export function useZoomEditing({
  controller,
  layout,
  timelineDuration,
  axis,
  recordings,
}: {
  controller: VideoSceneController;
  layout: LayoutEntry[];
  timelineDuration: number;
  /** The source axis: a zoom is clamped to the range of the recording it is in (ADR 0058). */
  axis: SourceAxis;
  /**
   * Every recording whose zooms can be re-detected: the opened one and each READY joined one,
   * with its own cursor track. A loading or missing recording is simply not listed, and its
   * zooms are left as they are.
   */
  recordings: readonly RecordingZoomInput[];
}): ZoomEditing {
  const { scene } = controller;

  const visibleZooms = useMemo(
    () => scene.zoomSegments.filter((z) => isSourceRangeVisible(layout, z.start, z.end)),
    [scene.zoomSegments, layout],
  );

  const coverage = useMemo(
    () => coverageOf(scene.zoomSegments, layout, timelineDuration),
    [scene.zoomSegments, layout, timelineDuration],
  );

  const addAtPlayhead = useCallback(
    (timelineTime: number): AddZoomResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return { ok: false, reason: "on-slide" };
      const window = freeWindowAt(
        controller.scene.zoomSegments,
        at,
        ZOOM_LIMITS.manualSeconds,
        clipBounds(axis, { sourceStart: at }),
        ZOOM_LIMITS.minSeconds,
      );
      if (!window) return { ok: false, reason: "no-room" };
      const { scene: next, id } = addManualZoom(controller.scene, window);
      controller.commit(next);
      return { ok: true, id };
    },
    [controller, layout, axis],
  );

  const remove = useCallback(
    (id: string) => {
      if (controller.interacting) return;
      controller.commit(removeZoom(controller.scene, id));
    },
    [controller],
  );

  const commitPatch = useCallback(
    (id: string, patch: ZoomPatch) => {
      if (controller.interacting) return;
      controller.commit(updateZoom(controller.scene, id, patch));
    },
    [controller],
  );

  const livePatch = useCallback(
    (id: string, patch: ZoomPatch) =>
      controller.updateLive(updateZoom(controller.scene, id, patch)),
    [controller],
  );

  const controllerRef = useLatest(controller);
  // An edge drag reports every pointermove, and a mouse can send several per frame. Each live
  // update re-renders the Zooms lane and the strip that hosts it (a hundred-odd blocks on a
  // long take), so the newest move is kept and applied once per animation frame, the same
  // coalescing the inspector sliders use (NIW2-662). Release applies the last pending move
  // first, so the final edge is exactly where the pointer let go.
  const pendingEdge = useRef<{ id: string; edge: "start" | "end"; sourceTime: number } | null>(
    null,
  );
  const edgeFrame = useRef(0);
  // The scene this drag last handed to updateLive. `controller.scene` is only the last RENDERED
  // scene, and the render behind a frame's update can still be pending when the pointer is
  // released; comparing against it could drop the final move.
  const lastEdgeScene = useRef<VideoScene | null>(null);
  const flushEdge = useCallback(() => {
    if (edgeFrame.current !== 0) {
      cancelAnimationFrame(edgeFrame.current);
      edgeFrame.current = 0;
    }
    const pending = pendingEdge.current;
    pendingEdge.current = null;
    if (!pending) return;
    const controller = controllerRef.current;
    const base = lastEdgeScene.current ?? controller.scene;
    const zoom = base.zoomSegments.find((z) => z.id === pending.id);
    if (!zoom) return;
    const bounds = clipBounds(axis, { sourceStart: zoom.start });
    const next = dragZoomEdge(base, pending.id, pending.edge, pending.sourceTime, bounds);
    // A move that lands on the same range changes nothing: keep the scene (and every lane) as is.
    if (sameZoomRange(base, next, pending.id)) return;
    lastEdgeScene.current = next;
    controller.updateLive(next);
  }, [controllerRef, axis]);
  useEffect(
    () => () => {
      if (edgeFrame.current !== 0) cancelAnimationFrame(edgeFrame.current);
    },
    [],
  );
  const edgeDrag = useCallback(
    (
      id: string,
      edge: "start" | "end",
      sourceTime: number | null,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") {
        lastEdgeScene.current = null;
        controllerRef.current.beginInteract();
      }
      if (phase === "move" && sourceTime !== null) {
        pendingEdge.current = { id, edge, sourceTime };
        edgeFrame.current ||= requestAnimationFrame(() => {
          edgeFrame.current = 0;
          flushEdge();
        });
      }
      if (phase === "end") {
        flushEdge();
        lastEdgeScene.current = null;
        controllerRef.current.endInteract();
      }
    },
    [controllerRef, flushEdge],
  );

  const liveLock = useCallback(
    (id: string, center: { x: number; y: number }) =>
      controller.updateLive(lockZoomAt(controller.scene, id, center)),
    [controller],
  );

  const canDetect = useMemo(() => recordings.some((r) => r.track !== null), [recordings]);

  const sensitivityPreview = useCallback(
    (value: number) => {
      if (!canDetect) return { count: visibleZooms.length, coverage };
      const next = applySensitivityToRecordings(controller.scene, recordings, value);
      return {
        count: next.zoomSegments.filter((z) => isSourceRangeVisible(layout, z.start, z.end)).length,
        coverage: coverageOf(next.zoomSegments, layout, timelineDuration),
      };
    },
    [controller, canDetect, recordings, layout, timelineDuration, visibleZooms, coverage],
  );

  const sensitivityCommit = useCallback(
    (value: number) => {
      if (!canDetect || controller.interacting) return;
      controller.commit(applySensitivityToRecordings(controller.scene, recordings, value));
    },
    [controller, canDetect, recordings],
  );

  // Re-run detection at the current sensitivity. Free when nothing changes:
  // applySensitivity returns the same scene reference and commit() no-ops on it, so the
  // button never manufactures an undo entry or a dirty editor (doc 07).
  const reanalyse = useCallback(() => {
    sensitivityCommit(controller.scene.zoomSensitivity);
  }, [controller, sensitivityCommit]);

  return {
    visibleZooms,
    coverage,
    addAtPlayhead,
    remove,
    commitPatch,
    begin: controller.beginInteract,
    livePatch,
    end: controller.endInteract,
    edgeDrag,
    liveLock,
    sensitivityPreview,
    sensitivityCommit,
    reanalyse,
    canDetect,
  };
}

function sameZoomRange(a: VideoScene, b: VideoScene, id: string): boolean {
  const before = a.zoomSegments.find((z) => z.id === id);
  const after = b.zoomSegments.find((z) => z.id === id);
  return !!before && !!after && before.start === after.start && before.end === after.end;
}
