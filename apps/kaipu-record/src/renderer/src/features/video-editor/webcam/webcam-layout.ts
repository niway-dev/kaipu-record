/**
 * Where the webcam layer sits in a frame (ADR 0033): the square the bubble occupies, in the
 * OUTPUT frame's pixels, for a layout and the camera path's scale at that instant. The
 * preview turns it into percentages of its stage; the export composer will draw it as is.
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free. It reads nothing but
 * the layout's own fields, so the export worker can import it.
 */
import type { CameraBubbleShape } from "@shared/camera-bubble";
import type { WebcamLayout } from "./webcam-model";

export interface WebcamRect {
  /** Left edge, in the frame's units (pixels for a pixel frame). */
  x: number;
  /** Top edge. */
  y: number;
  /** Side of the square; circle and rounded are both drawn in a square. */
  size: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * The camera path's scale at which the bubble has fully shrunk to `scaleDuringZoom`. Below
 * it the bubble shrinks in proportion, so it eases with the camera's own spring instead of
 * snapping the moment a zoom starts (spec open question 3).
 */
export const WEBCAM_SHRINK_FULL_AT_SCALE = 1.5;

/** The rounded square's corner as a share of its side, the same as the recorder's bubble. */
export const WEBCAM_ROUNDED_RADIUS = 0.18;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The factor the bubble's side is multiplied by at camera scale `cameraScale`: 1 without a
 * zoom, `scaleDuringZoom` from {@link WEBCAM_SHRINK_FULL_AT_SCALE} up, linear in between.
 */
export function webcamZoomFactor(scaleDuringZoom: number, cameraScale: number): number {
  const scale = Number.isFinite(cameraScale) ? cameraScale : 1;
  const progress = clamp((scale - 1) / (WEBCAM_SHRINK_FULL_AT_SCALE - 1), 0, 1);
  return 1 - (1 - clamp(scaleDuringZoom, 0, 1)) * progress;
}

/**
 * A centre (normalized, 0–1) moved just enough that a bubble of `side` pixels stays inside
 * the frame. A bubble wider than the frame (a tall bubble on a very narrow frame) is centred.
 */
export function clampWebcamCenter(
  center: { x: number; y: number },
  side: number,
  frame: FrameSize,
): { x: number; y: number } {
  const axis = (value: number, length: number): number => {
    if (length <= 0) return 0.5;
    const half = side / 2 / length;
    return half >= 0.5 ? 0.5 : clamp(value, half, 1 - half);
  };
  return { x: axis(center.x, frame.width), y: axis(center.y, frame.height) };
}

/**
 * The bubble's square in `frame`, or null for an empty frame. Side = `size` × frame height ×
 * the zoom factor; the centre is the layout's, clamped so the whole square stays inside.
 */
export function webcamRect(
  layout: Pick<WebcamLayout, "size" | "position" | "scaleDuringZoom">,
  frame: FrameSize,
  cameraScale = 1,
): WebcamRect | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const side = layout.size * frame.height * webcamZoomFactor(layout.scaleDuringZoom, cameraScale);
  const center = clampWebcamCenter(layout.position, side, frame);
  return {
    x: center.x * frame.width - side / 2,
    y: center.y * frame.height - side / 2,
    size: side,
  };
}

/** CSS `clip-path` for the bubble's shape, relative to its own square. */
export function webcamClipPath(shape: CameraBubbleShape): string {
  return shape === "circle"
    ? "circle(50% at 50% 50%)"
    : `inset(0 round ${Math.round(WEBCAM_ROUNDED_RADIUS * 100)}%)`;
}

/** The nine inspector presets, as normalized centres; the clamp pulls them to the edges. */
export const WEBCAM_POSITION_PRESETS = [
  { id: "top-left", x: 0, y: 0 },
  { id: "top", x: 0.5, y: 0 },
  { id: "top-right", x: 1, y: 0 },
  { id: "left", x: 0, y: 0.5 },
  { id: "center", x: 0.5, y: 0.5 },
  { id: "right", x: 1, y: 0.5 },
  { id: "bottom-left", x: 0, y: 1 },
  { id: "bottom", x: 0.5, y: 1 },
  { id: "bottom-right", x: 1, y: 1 },
] as const;

export type WebcamPositionPresetId = (typeof WEBCAM_POSITION_PRESETS)[number]["id"];

/** Gap kept between a preset's bubble and the frame edge, as a fraction of the frame height. */
export const WEBCAM_PRESET_MARGIN = 0.04;

/**
 * The centre a preset puts a bubble of `size` (fraction of the height) at in `frame`: snug
 * against its edges with {@link WEBCAM_PRESET_MARGIN} of air, so the stored position is the
 * one drawn (no clamp hides a difference that would surface on another preset).
 */
export function webcamPresetCenter(
  preset: { x: number; y: number },
  size: number,
  frame: FrameSize,
): { x: number; y: number } {
  if (!(frame.width > 0) || !(frame.height > 0)) return { x: preset.x, y: preset.y };
  const side = size * frame.height;
  const margin = WEBCAM_PRESET_MARGIN * frame.height;
  const reach = (value: number, length: number): number => {
    const half = side / 2 + margin;
    if (half * 2 >= length) return 0.5;
    return (half + value * (length - 2 * half)) / length;
  };
  return { x: reach(preset.x, frame.width), y: reach(preset.y, frame.height) };
}
