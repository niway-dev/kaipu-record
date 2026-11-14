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
import type { SceneSource, VideoScene } from "./scene";
import { detectRecordingZooms } from "./zoom/recording-zooms";

export function withInitialZooms(
  scene: VideoScene,
  hasZoomData: boolean,
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): VideoScene {
  if (!track || hasZoomData) return scene;
  return {
    ...scene,
    zoomSegments: detectRecordingZooms(
      [{ offset: 0, duration: sourceDurationSeconds, track }],
      scene.zoomSensitivity,
    ),
  };
}

/**
 * A joined recording's auto zooms (ADR 0058), added to the scene at its sensitivity: detected on
 * the recording's own track and shifted into its range. Every other segment, manual or auto,
 * stays exactly as it was; a detected one that would overlap an existing segment is skipped, so
 * the one-active-zoom rule holds. Returns the same scene without a track or without detections.
 */
export function withJoinedZooms(
  scene: VideoScene,
  source: SceneSource,
  track: CursorTrack | null,
): VideoScene {
  if (!track) return scene;
  const detected = detectRecordingZooms(
    [{ offset: source.offset, duration: source.durationSeconds, track }],
    scene.zoomSensitivity,
  ).filter((d) => !scene.zoomSegments.some((z) => d.start < z.end && z.start < d.end));
  if (detected.length === 0) return scene;
  return {
    ...scene,
    zoomSegments: [...scene.zoomSegments, ...detected].sort((a, b) => a.start - b.start),
  };
}
