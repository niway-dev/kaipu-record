/**
 * Result view: applies the camera of the current frame to the preview content element
 * as a CSS transform — no re-encode, no React re-render per frame (UI spec rule 6).
 * `enabled = false` (a zoom is being edited, the original is held, a slide is showing)
 * clears the transform so the full original frame is visible.
 */
import { useMemo } from "react";
import { useVideoFrameClock } from "../use-video-frame-clock";
import { type CameraPath, cameraAt, isIdentity } from "./camera-path";
import { cameraTransform } from "./camera-css";

export function useCameraPreview(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  path: CameraPath,
  enabled: boolean,
): void {
  const trigger = useMemo(() => ({ path, enabled }), [path, enabled]);
  useVideoFrameClock(
    videoRef,
    (t) => {
      const el = contentRef.current;
      if (!el) return;
      const cam = cameraAt(path, t);
      el.style.transform = enabled && !isIdentity(cam) ? cameraTransform(cam) : "";
    },
    trigger,
  );
}
