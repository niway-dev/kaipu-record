import { Camera } from "lucide-react";
import {
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  cameraBubbleWindowInArea,
  cameraCornerRadiusPx,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import styles from "./capture-overlay.module.css";

/**
 * Where main will draw the visible camera bubble of `size` in `frame` (the same rule as
 * `bubbleBoundsInArea`): bottom-left, shrunk to what the box holds, or null when not even
 * the minimum size fits. The window is as wide as the shape, so the bubble is the window
 * inset by the pad on every side.
 */
export function cameraPreviewPlacement(
  frame: CaptureRect,
  size: number = DEFAULT_CAMERA_BUBBLE.size,
  shape: CameraBubbleShape = DEFAULT_CAMERA_BUBBLE.shape,
): CaptureRect | null {
  const window = cameraBubbleWindowInArea(frame, size, undefined, shape);
  if (!window) return null;
  const pad = CAMERA_BUBBLE_WINDOW_PAD;
  return {
    x: window.x + pad,
    y: window.y + pad,
    width: window.width - 2 * pad,
    height: window.height - 2 * pad,
  };
}

/** Where the camera bubble will be recorded, drawn while the camera is on. */
export function CameraPreview({
  rect,
  shape = DEFAULT_CAMERA_BUBBLE.shape,
  cornerRadius = DEFAULT_CAMERA_BUBBLE.cornerRadius,
}: {
  rect: CaptureRect;
  shape?: CameraBubbleShape;
  cornerRadius?: number;
}): React.JSX.Element {
  const radius = cameraCornerRadiusPx(shape, cornerRadius, rect.width, rect.height);
  return (
    <div
      className={styles.cameraPreview}
      data-testid="camera-preview"
      data-shape={shape}
      aria-hidden
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius: Math.round(radius),
      }}
    >
      <Camera size={28} aria-hidden />
    </div>
  );
}
