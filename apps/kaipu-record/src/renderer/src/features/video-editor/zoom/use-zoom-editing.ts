/**
 * Zoom editing handlers for the editor page, following the scene-history contract of
 * plans/video-editor-v2/07: discrete actions commit; continuous gestures (sliders, edge
 * drags, camera-box drag) run begin → live… → end.
 *
 * Every handler reads `controller.scene` — the scene as of the last render. That is NOT
 * useVideoScene's private `sceneRef` (the ref is what makes endInteract's comparison
 * exact and is not exposed), but it is correct here because each pointer/change event
 * flushes its own render before the next one arrives, so a live handler always sees the
 * result of the previous live update. What must never happen is closing over a `scene`
 * captured in the page's render body and kept across renders — hence `controller` in
 * every dependency array.
 */
import { useCallback, useMemo } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import { freeWindowAt, isSourceRangeVisible, sourceTimeAtTimeline } from "../source-time";
import type { LayoutEntry } from "../timeline";
import type { VideoSceneController } from "../use-video-scene";
import {
  addManualZoom,
  applySensitivity,
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
  sensitivityLive(value: number): void;
  sensitivityCommit(value: number): void;
  reanalyse(): void;
  /** False when the recording has no cursor track (Detection panel shows its empty state). */
  canDetect: boolean;
}

export function useZoomEditing({
  controller,
  layout,
  timelineDuration,
  sourceDuration,
  cursorTrack,
}: {
  controller: VideoSceneController;
  layout: LayoutEntry[];
  timelineDuration: number;
  sourceDuration: number;
  cursorTrack: CursorTrack | null;
}): ZoomEditing {
  const { scene } = controller;

  const visibleZooms = useMemo(
    () => scene.zoomSegments.filter((z) => isSourceRangeVisible(layout, z.start, z.end)),
    [scene.zoomSegments, layout],
  );

  const coverage = useMemo(() => {
    if (timelineDuration <= 0) return 0;
    let covered = 0;
    for (const entry of layout) {
      if (entry.kind !== "clip") continue;
      for (const z of scene.zoomSegments) {
        covered += Math.max(
          0,
          Math.min(z.end, entry.sourceEnd) - Math.max(z.start, entry.sourceStart),
        );
      }
    }
    return Math.min(1, covered / timelineDuration);
  }, [scene.zoomSegments, layout, timelineDuration]);

  const addAtPlayhead = useCallback(
    (timelineTime: number): AddZoomResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return { ok: false, reason: "on-slide" };
      const window = freeWindowAt(
        controller.scene.zoomSegments,
        at,
        ZOOM_LIMITS.manualSeconds,
        sourceDuration,
        ZOOM_LIMITS.minSeconds,
      );
      if (!window) return { ok: false, reason: "no-room" };
      const { scene: next, id } = addManualZoom(controller.scene, window);
      controller.commit(next);
      return { ok: true, id };
    },
    [controller, layout, sourceDuration],
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

  const edgeDrag = useCallback(
    (
      id: string,
      edge: "start" | "end",
      sourceTime: number | null,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move" && sourceTime !== null) {
        controller.updateLive(dragZoomEdge(controller.scene, id, edge, sourceTime, sourceDuration));
      }
      if (phase === "end") controller.endInteract();
    },
    [controller, sourceDuration],
  );

  const liveLock = useCallback(
    (id: string, center: { x: number; y: number }) =>
      controller.updateLive(lockZoomAt(controller.scene, id, center)),
    [controller],
  );

  const sensitivityLive = useCallback(
    (value: number) => {
      if (!cursorTrack) return;
      controller.updateLive(applySensitivity(controller.scene, cursorTrack, sourceDuration, value));
    },
    [controller, cursorTrack, sourceDuration],
  );

  const sensitivityCommit = useCallback(
    (value: number) => {
      if (!cursorTrack || controller.interacting) return;
      controller.commit(applySensitivity(controller.scene, cursorTrack, sourceDuration, value));
    },
    [controller, cursorTrack, sourceDuration],
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
    sensitivityLive,
    sensitivityCommit,
    reanalyse,
    canDetect: cursorTrack !== null,
  };
}
