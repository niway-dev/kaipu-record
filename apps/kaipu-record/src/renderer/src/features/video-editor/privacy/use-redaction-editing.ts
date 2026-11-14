/**
 * Privacy-region editing handlers for the editor page — same history contract as
 * use-zoom-editing (plans/video-editor-v2/07). Regions are SOURCE-anchored (doc 06) and
 * may overlap each other.
 */
import { useCallback, useMemo } from "react";
import { useLatest } from "../use-latest";
import { clipBounds, type SourceAxis } from "../source-axis";
import { dragRangeEdge, isSourceRangeVisible, sourceTimeAtTimeline } from "../source-time";
import type { LayoutEntry } from "../timeline";
import type { VideoSceneController } from "../use-video-scene";
import { REDACTION, type NormRect, type Redaction } from "./redaction";
import {
  addRedaction,
  type BlurPatch,
  type CoverPatch,
  removeRedaction,
  updateRedaction,
} from "./redaction-edits";

export type AddRedactionResult =
  | { ok: true; id: string }
  | { ok: false; reason: "on-slide" | "too-small" | "busy" };

export interface RedactionEditing {
  visibleRedactions: Redaction[];
  /** Source window a region drawn now would get (for the range badge / ghost block); null on a slide. */
  windowAt(timelineTime: number): { start: number; end: number } | null;
  add(kind: Redaction["kind"], rect: NormRect, timelineTime: number): AddRedactionResult;
  remove(id: string): void;
  commitPatch(id: string, patch: BlurPatch | CoverPatch): void;
  begin(): void;
  livePatch(id: string, patch: BlurPatch | CoverPatch): void;
  end(): void;
  edgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
}

export function useRedactionEditing({
  controller,
  layout,
  axis,
}: {
  controller: VideoSceneController;
  layout: LayoutEntry[];
  /** The source axis: a region is clamped to the range of the recording it is in (ADR 0058). */
  axis: SourceAxis;
}): RedactionEditing {
  const { scene } = controller;

  const visibleRedactions = useMemo(
    () => scene.redactions.filter((r) => isSourceRangeVisible(layout, r.start, r.end)),
    [scene.redactions, layout],
  );

  const windowAt = useCallback(
    (timelineTime: number) => {
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return null;
      const bounds = clipBounds(axis, { sourceStart: at });
      const start = Math.min(at, Math.max(bounds.start, bounds.end - REDACTION.minSeconds));
      return { start, end: Math.min(bounds.end, start + REDACTION.defaultSeconds) };
    },
    [layout, axis],
  );

  const add = useCallback(
    (kind: Redaction["kind"], rect: NormRect, timelineTime: number): AddRedactionResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      if (rect.w < REDACTION.minSize || rect.h < REDACTION.minSize)
        return { ok: false, reason: "too-small" };
      const window = windowAt(timelineTime);
      if (!window) return { ok: false, reason: "on-slide" };
      const { scene: next, id } = addRedaction(controller.scene, kind, rect, window);
      controller.commit(next);
      return { ok: true, id };
    },
    [controller, windowAt],
  );

  const remove = useCallback(
    (id: string) => {
      if (controller.interacting) return;
      controller.commit(removeRedaction(controller.scene, id));
    },
    [controller],
  );

  const commitPatch = useCallback(
    (id: string, patch: BlurPatch | CoverPatch) => {
      if (controller.interacting) return;
      controller.commit(updateRedaction(controller.scene, id, patch));
    },
    [controller],
  );

  const livePatch = useCallback(
    (id: string, patch: BlurPatch | CoverPatch) =>
      controller.updateLive(updateRedaction(controller.scene, id, patch)),
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
        const self = controllerRef.current.scene.redactions.find((r) => r.id === id);
        if (self) {
          // Regions may overlap: the only sibling that constrains the drag is itself.
          const range = dragRangeEdge(
            [self],
            id,
            edge,
            sourceTime,
            clipBounds(axis, { sourceStart: self.start }),
            REDACTION.minSeconds,
          );
          controllerRef.current.updateLive(updateRedaction(controllerRef.current.scene, id, range));
        }
      }
      if (phase === "end") controllerRef.current.endInteract();
    },
    [controllerRef, axis],
  );

  return {
    visibleRedactions,
    windowAt,
    add,
    remove,
    commitPatch,
    begin: controller.beginInteract,
    livePatch,
    end: controller.endInteract,
    edgeDrag,
  };
}
