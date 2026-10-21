/**
 * CSS transform that shows the camera window of `cam` filling the element. Apply with
 * `transform-origin: 0 0`. A point p (px) maps to s · (p − x·W): translate first (by
 * the window's offset, as a % of the element's own size), then scale.
 */
import { type CameraState, cropRect } from "./camera-path";

export function cameraTransform(cam: CameraState): string {
  const r = cropRect(cam);
  return `scale(${cam.scale}) translate(${-r.x * 100}%, ${-r.y * 100}%)`;
}
