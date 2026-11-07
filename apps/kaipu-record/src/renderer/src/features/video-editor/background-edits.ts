import { parseBackground, type VideoBackground } from "./background";
import { backgroundOf, type VideoScene } from "./scene";

export type BackgroundPatch = Partial<VideoBackground>;

/**
 * The scene with `patch` applied to its background, clamped to the screenshot editor's ranges.
 * Returns the SAME scene when nothing changes, so `commit` records no undo step and the editor
 * does not turn dirty for a click on the preset that is already chosen. The padding, radius and
 * shadow are kept when the preset goes back to `none`: choosing a preset again restores them.
 */
export function updateBackground(scene: VideoScene, patch: BackgroundPatch): VideoScene {
  const current = backgroundOf(scene);
  const next = parseBackground({ ...current, ...patch });
  if (
    next.bg === current.bg &&
    next.padding === current.padding &&
    next.radius === current.radius &&
    next.shadow === current.shadow
  ) {
    return scene;
  }
  return { ...scene, background: next };
}
