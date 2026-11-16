/**
 * Webcam layer editing for the editor page (ADR 0038), on the scene-history contract of
 * plans/video-editor-v2/07 like `useZoomEditing`: discrete actions commit; continuous
 * gestures (dragging the bubble, a slider, a lane edge) run begin → live… → end and land as
 * ONE undo step.
 *
 * Layout edits go to whatever is in force at the playhead: inside an `override` segment they
 * change the override (so the user edits what they see), anywhere else the global layout.
 * Every handler reads `controller.scene`, never a scene captured at render time.
 */
import { useCallback, useMemo } from "react";
import { useLatest } from "../use-latest";
import { freeWindowAt, isSourceRangeVisible, sourceTimeAtTimeline } from "../source-time";
import type { LayoutEntry } from "../timeline";
import type { VideoScene } from "../scene";
import type { VideoSceneController } from "../use-video-scene";
import {
  addWebcamSegment,
  changeWebcamFrom,
  dragWebcamSegmentEdge,
  removeWebcamSegment,
  setWebcamLayout,
  setWebcamTransition,
  updateWebcamSegment,
} from "./webcam-edits";
import {
  WEBCAM_MIN_SEGMENT_SECONDS,
  webcamOverrideAt,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
  type WebcamTransition,
} from "./webcam-model";

export type HideWebcamResult =
  | { ok: true; id: string }
  | { ok: false; reason: "on-slide" | "no-room" | "busy" };

export type ChangeCameraBlockedReason = "on-slide" | "hidden" | "no-room";

export type ChangeCameraResult =
  | { ok: true; id: string; kind: "create" | "split" }
  | { ok: false; reason: ChangeCameraBlockedReason | "busy" };

export interface WebcamEditing {
  /** The scene's webcam, or null when the recording has none (nothing below applies then). */
  webcam: WebcamScene | null;
  /** Segments with at least one visible piece — what the lane and inspector use. */
  visibleSegments: WebcamSegment[];
  /**
   * "Hide webcam here": a hidden segment from the playhead to the next segment (or the end of
   * the recording). Inside an existing segment it returns that one instead of adding another.
   */
  hideAtPlayhead(timelineTime: number): HideWebcamResult;
  /**
   * "Change camera from here": a block from the playhead to the next block or the end of the
   * recording, or, inside a block, a split of that block at the playhead. One undo step.
   */
  changeAtPlayhead(timelineTime: number): ChangeCameraResult;
  /** Why "Change camera from here" would do nothing at the playhead; null when it can. */
  changeBlockedReason(timelineTime: number): ChangeCameraBlockedReason | null;
  /** A discrete change of a block's Slide or Cut, duration or easing. */
  commitTransition(id: string, patch: Partial<WebcamTransition>): void;
  /** A live transition change during a gesture; `end()` makes it one undo step. */
  liveTransition(id: string, patch: Partial<WebcamTransition>): void;
  remove(id: string): void;
  edgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
  /** A discrete layout change (a button, a preset) for what is in force at `sourceTime`. */
  commitLayout(patch: Partial<WebcamLayout>, sourceTime: number | null): void;
  begin(): void;
  /** A live layout change during a gesture; `end()` makes it one undo step. */
  liveLayout(patch: Partial<WebcamLayout>, sourceTime: number | null): void;
  end(): void;
}

/** Apply a layout patch to the override at `t`, or to the global layout outside one. */
export function patchWebcamAt(
  scene: VideoScene,
  patch: Partial<WebcamLayout>,
  t: number | null,
): VideoScene {
  if (!scene.webcam) return scene;
  // The override in force at `t` is the segment a layout edit there belongs to.
  const override = webcamOverrideAt(scene.webcam, t);
  return override
    ? updateWebcamSegment(scene, override.id, { layout: patch })
    : setWebcamLayout(scene, patch);
}

export function useWebcamEditing({
  controller,
  layout,
  sourceDuration,
}: {
  controller: VideoSceneController;
  layout: LayoutEntry[];
  sourceDuration: number;
}): WebcamEditing {
  const webcam = controller.scene.webcam;

  const visibleSegments = useMemo(
    () =>
      webcam ? webcam.segments.filter((s) => isSourceRangeVisible(layout, s.start, s.end)) : [],
    [webcam, layout],
  );

  const hideAtPlayhead = useCallback(
    (timelineTime: number): HideWebcamResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      const current = controller.scene.webcam;
      if (!current) return { ok: false, reason: "no-room" };
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return { ok: false, reason: "on-slide" };
      const existing = current.segments.find((s) => at >= s.start && at < s.end);
      if (existing) return { ok: true, id: existing.id };
      const window = freeWindowAt(
        current.segments,
        at,
        Number.POSITIVE_INFINITY,
        sourceDuration,
        WEBCAM_MIN_SEGMENT_SECONDS,
      );
      if (!window) return { ok: false, reason: "no-room" };
      const { scene: next, id } = addWebcamSegment(
        controller.scene,
        { ...window, mode: "hidden" },
        sourceDuration,
      );
      if (!id) return { ok: false, reason: "no-room" };
      controller.commit(next);
      return { ok: true, id };
    },
    [controller, layout, sourceDuration],
  );

  const changeAtPlayhead = useCallback(
    (timelineTime: number): ChangeCameraResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return { ok: false, reason: "on-slide" };
      const result = changeWebcamFrom(controller.scene, at, sourceDuration);
      if (!result.ok) return { ok: false, reason: result.reason };
      controller.commit(result.scene);
      return { ok: true, id: result.id, kind: result.kind };
    },
    [controller, layout, sourceDuration],
  );

  const changeBlockedReason = useCallback(
    (timelineTime: number): ChangeCameraBlockedReason | null => {
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return "on-slide";
      const result = changeWebcamFrom(controller.scene, at, sourceDuration);
      return result.ok ? null : result.reason;
    },
    [controller, layout, sourceDuration],
  );

  const commitTransition = useCallback(
    (id: string, patch: Partial<WebcamTransition>) => {
      if (controller.interacting) return;
      controller.commit(setWebcamTransition(controller.scene, id, patch));
    },
    [controller],
  );

  const liveTransition = useCallback(
    (id: string, patch: Partial<WebcamTransition>) =>
      controller.updateLive(setWebcamTransition(controller.scene, id, patch)),
    [controller],
  );

  const remove = useCallback(
    (id: string) => {
      if (controller.interacting) return;
      controller.commit(removeWebcamSegment(controller.scene, id));
    },
    [controller],
  );

  const controllerRef = useLatest(controller);
  const edgeDrag = useCallback(
    (
      id: string,
      edge: "start" | "end",
      sourceTime: number | null,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") controllerRef.current.beginInteract();
      if (phase === "move" && sourceTime !== null) {
        controllerRef.current.updateLive(
          dragWebcamSegmentEdge(controllerRef.current.scene, id, edge, sourceTime, sourceDuration),
        );
      }
      if (phase === "end") controllerRef.current.endInteract();
    },
    [controllerRef, sourceDuration],
  );

  const commitLayout = useCallback(
    (patch: Partial<WebcamLayout>, sourceTime: number | null) => {
      if (controller.interacting) return;
      controller.commit(patchWebcamAt(controller.scene, patch, sourceTime));
    },
    [controller],
  );

  const liveLayout = useCallback(
    (patch: Partial<WebcamLayout>, sourceTime: number | null) =>
      controller.updateLive(patchWebcamAt(controller.scene, patch, sourceTime)),
    [controller],
  );

  return {
    webcam,
    visibleSegments,
    hideAtPlayhead,
    changeAtPlayhead,
    changeBlockedReason,
    commitTransition,
    liveTransition,
    remove,
    edgeDrag,
    commitLayout,
    begin: controller.beginInteract,
    liveLayout,
    end: controller.endInteract,
  };
}
