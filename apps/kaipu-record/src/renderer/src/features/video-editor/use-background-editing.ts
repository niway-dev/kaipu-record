import { useCallback } from "react";
import type { BackgroundId } from "../screenshots/beautify/backgrounds";
import type { VideoBackground } from "./background";
import { updateBackground, type BackgroundPatch } from "./background-edits";
import { backgroundOf } from "./scene";
import type { VideoSceneController } from "./use-video-scene";

export interface BackgroundEditing {
  /** The scene's background as it is now (the default for a scene that never set one). */
  background: VideoBackground;
  /** A preset click: one undo step. */
  choose(bg: BackgroundId): void;
  /** A discrete number change (a keyboard step): one undo step. */
  commit(patch: BackgroundPatch): void;
  /** A slider gesture is ONE undo step: `begin`, any number of `live`, then `end`. */
  begin(): void;
  live(patch: BackgroundPatch): void;
  end(): void;
}

/**
 * The background, wired to the scene's undo history with the same contract as the zoom
 * inspector's sliders (`HistorySlider`): a pointer gesture is one step, a keyboard step is
 * one step, and nothing commits while another drag owns the scene.
 */
export function useBackgroundEditing(controller: VideoSceneController): BackgroundEditing {
  const commit = useCallback(
    (patch: BackgroundPatch) => {
      if (controller.interacting) return;
      controller.commit(updateBackground(controller.scene, patch));
    },
    [controller],
  );
  const choose = useCallback((bg: BackgroundId) => commit({ bg }), [commit]);
  const live = useCallback(
    (patch: BackgroundPatch) => controller.updateLive(updateBackground(controller.scene, patch)),
    [controller],
  );
  return {
    background: backgroundOf(controller.scene),
    choose,
    commit,
    begin: controller.beginInteract,
    live,
    end: controller.endInteract,
  };
}
