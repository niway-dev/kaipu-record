import { useMemo } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import { buildCameraPath, type CameraPath } from "./camera-path";
import type { ZoomSegment } from "./zoom-model";

/**
 * The camera path for the current scene. Rebuilt only when its inputs change by
 * reference — `zoomSegments` is replaced (never mutated) on every edit, so a drag
 * rebuilds it once per live update, which is cheap (~0.5 ms per minute of video).
 */
export function useCameraPath(
  segments: ZoomSegment[],
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): CameraPath {
  return useMemo(
    () => buildCameraPath(segments, track, sourceDurationSeconds),
    [segments, track, sourceDurationSeconds],
  );
}
