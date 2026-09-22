/**
 * Decides the zoom segments of the scene the editor OPENS with. Pure; called by the
 * loader before `useVideoScene` is created, so the result is the initial scene (not a
 * commit → the editor is not dirty after merely opening it).
 *
 *   no cursor track                 → scene unchanged (no zooms, as before v2)
 *   session saved with v2 data      → scene unchanged (the user's zooms win)
 *   fresh open / pre-v2 session     → detect at the scene's sensitivity
 */
import type { CursorTrack } from "@shared/cursor-track";
import type { VideoScene } from "./scene";
import { detectZoomSegments } from "./zoom/detect-zoom-segments";

export function withInitialZooms(
  scene: VideoScene,
  hasZoomData: boolean,
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): VideoScene {
  if (!track || hasZoomData) return scene;
  return {
    ...scene,
    zoomSegments: detectZoomSegments(track, sourceDurationSeconds, scene.zoomSensitivity),
  };
}
