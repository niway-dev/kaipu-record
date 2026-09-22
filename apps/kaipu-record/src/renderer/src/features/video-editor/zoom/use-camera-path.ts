import { useEffect, useRef, useState } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import { buildCameraPath, type CameraPath } from "./camera-path";
import type { ZoomSegment } from "./zoom-model";

interface Inputs {
  segments: ZoomSegment[];
  track: CursorTrack | null;
  sourceDurationSeconds: number;
}

/**
 * The camera path for the current scene: ONE simulation shared by the preview and the
 * export (doc 05). Rebuilt at most once per animation frame.
 *
 * buildCameraPath walks the entire source — 26 ms / 2.6 MB for an hour of recording —
 * and `zoomSegments` is replaced on every live update of a slider, an edge drag or the
 * camera box. Rebuilding synchronously per pointermove would spend all of it on paths
 * that are never drawn. Coalescing to one rebuild per frame from the latest inputs
 * costs at most one frame of staleness and bounds the work at what the screen can show.
 */
export function useCameraPath(
  segments: ZoomSegment[],
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): CameraPath {
  const latest = useRef<Inputs>({ segments, track, sourceDurationSeconds });
  latest.current = { segments, track, sourceDurationSeconds };
  // Synchronous first build: the very first painted frame is already zoomed correctly.
  const built = useRef<Inputs>(latest.current);
  const [path, setPath] = useState<CameraPath>(() =>
    buildCameraPath(segments, track, sourceDurationSeconds),
  );
  const frame = useRef(0);

  // No dependency array: this compares references itself, because the point is to react
  // to input changes WITHOUT scheduling work for each one.
  useEffect(() => {
    const now = latest.current;
    const done = built.current;
    if (
      done.segments === now.segments &&
      done.track === now.track &&
      done.sourceDurationSeconds === now.sourceDurationSeconds
    ) {
      return;
    }
    if (frame.current !== 0) return; // a rebuild is already queued; it will read `latest`
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const inputs = latest.current;
      built.current = inputs;
      setPath(buildCameraPath(inputs.segments, inputs.track, inputs.sourceDurationSeconds));
    });
  });

  useEffect(() => {
    return () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    };
  }, []);

  return path;
}
