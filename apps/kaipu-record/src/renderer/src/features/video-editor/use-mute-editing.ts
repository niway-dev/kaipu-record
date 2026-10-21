import { useCallback } from "react";

import { addMuteAt, dragMuteEdge, removeMute, toggleMuteAll } from "./mute-edits";
import type { MutedRange } from "./audio-edits";
import { sourceTimeAtTimeline } from "./source-time";
import type { LayoutEntry } from "./timeline";
import type { VideoSceneController } from "./use-video-scene";

export type AddMuteResult =
  | { ok: true; id: string }
  | { ok: false; reason: "on-slide" | "no-room" | "busy" };

export interface MuteEditing {
  /** Every muted range; they are kept even when the footage they cover is cut away. */
  mutedRanges: MutedRange[];
  /** True when the whole recording is silent — the export then drops the audio track. */
  audioMuted: boolean;
  addAtPlayhead(timelineTime: number): AddMuteResult;
  remove(id: string): void;
  toggleAll(): void;
  /** Same phase contract as the zoom and privacy lanes. */
  edgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
}

/**
 * Muted ranges, wired to the scene's undo history.
 *
 * Mirrors `useZoomEditing` so the two lanes behave identically under the hand:
 * add at the playhead, drag either edge, delete from the inspector. The one
 * difference the model allows is that a mute never fails for lack of a free
 * window, because muted ranges may overlap.
 */
export function useMuteEditing(
  controller: VideoSceneController,
  layout: LayoutEntry[],
  sourceDuration: number,
): MuteEditing {
  const addAtPlayhead = useCallback(
    (timelineTime: number): AddMuteResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      // A slide has no audio of its own, so there is nothing there to silence.
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return { ok: false, reason: "on-slide" };
      const added = addMuteAt(controller.scene, at, sourceDuration);
      if (!added) return { ok: false, reason: "no-room" };
      controller.commit(added.scene);
      return { ok: true, id: added.id };
    },
    [controller, layout, sourceDuration],
  );

  const remove = useCallback(
    (id: string) => {
      if (controller.interacting) return;
      controller.commit(removeMute(controller.scene, id));
    },
    [controller],
  );

  const toggleAll = useCallback(() => {
    if (controller.interacting) return;
    controller.commit(toggleMuteAll(controller.scene));
  }, [controller]);

  const edgeDrag = useCallback(
    (
      id: string,
      edge: "start" | "end",
      sourceTime: number | null,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move" && sourceTime !== null) {
        controller.updateLive(dragMuteEdge(controller.scene, id, edge, sourceTime, sourceDuration));
      }
      if (phase === "end") controller.endInteract();
    },
    [controller, sourceDuration],
  );

  return {
    mutedRanges: controller.scene.mutedRanges,
    audioMuted: controller.scene.audioMuted,
    addAtPlayhead,
    remove,
    toggleAll,
    edgeDrag,
  };
}
