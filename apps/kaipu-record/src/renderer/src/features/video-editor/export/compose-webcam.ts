/**
 * The webcam layer on an exported frame (ADR 0033): the last composition step, drawn onto
 * the OUTPUT canvas after the camera path's crop and, for fixed-canvas presets, after the
 * framer, so the zoom moves the content under it and Fill never crops it.
 *
 * The geometry is the preview's own (`webcam-layout.ts`): `webcamAt` picks the layout in
 * force at the frame's source time, `webcamRect` places it in the output frame with the
 * camera path's scale for "shrink during zoom", and `webcamSourceRect` is the window of the
 * webcam image that the preview's `object-fit: cover` + `framingTransform` shows.
 *
 *   shadow (the shape filled, shadowed) → clip(shape) → (mirror) → drawImage(window → square)
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free.
 */
import type { CameraBubbleShape } from "@shared/camera-bubble";
import {
  type FrameSize,
  WEBCAM_ROUNDED_RADIUS,
  WEBCAM_SHADOW,
  type WebcamRect,
  webcamRect,
  webcamSourceRect,
} from "../webcam/webcam-layout";
import { webcamAt, type WebcamScene } from "../webcam/webcam-model";

/** A decoded webcam frame and its size in pixels. */
export interface WebcamImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface WebcamDrawPlan {
  /** The bubble's square in the output frame. */
  rect: WebcamRect;
  /** The window of the (unmirrored) webcam image drawn into it. */
  src: { sx: number; sy: number; sw: number; sh: number };
  mirrored: boolean;
  shape: CameraBubbleShape;
  shadow: boolean;
}

/** The subset of the 2D context the layer uses (an OffscreenCanvas 2D in the worker). */
export interface WebcamCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  fill(): void;
  clip(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/**
 * What to draw for the webcam at source time `sourceTs` on a `frame`-sized output, or null:
 * no webcam, a hidden segment, no decoded webcam frame there (before its first frame, after
 * its last), or an empty frame.
 */
export function planWebcamDraw(
  webcam: WebcamScene | null,
  sourceTs: number,
  frame: FrameSize,
  cameraScale: number,
  image: FrameSize | null,
): WebcamDrawPlan | null {
  if (!webcam || !image || !(image.width > 0) || !(image.height > 0)) return null;
  const layout = webcamAt({ webcam }, sourceTs);
  if (!layout) return null;
  const rect = webcamRect(layout, frame, cameraScale);
  if (!rect || !(rect.size > 0)) return null;
  return {
    rect,
    src: webcamSourceRect(image, layout.framing, layout.mirrored),
    mirrored: layout.mirrored,
    shape: layout.shape,
    shadow: layout.shadow,
  };
}

function shapePath(ctx: WebcamCtx, shape: CameraBubbleShape, rect: WebcamRect): void {
  const { x, y, size } = rect;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  } else {
    const r = WEBCAM_ROUNDED_RADIUS * size;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
  }
  ctx.closePath();
}

/** Draws the planned layer onto `ctx`; the caller has composed everything under it. */
export function drawWebcamLayer(
  ctx: WebcamCtx,
  image: CanvasImageSource,
  plan: WebcamDrawPlan,
): void {
  const { rect, src } = plan;
  if (plan.shadow) {
    // The shape filled with its shadow first: the image drawn over it covers the fill, so
    // only the shadow shows, and the clip below cannot cut it off.
    ctx.save();
    ctx.shadowColor = WEBCAM_SHADOW.color;
    ctx.shadowBlur = WEBCAM_SHADOW.blur * rect.size;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = WEBCAM_SHADOW.offsetY * rect.size;
    ctx.fillStyle = "#000";
    shapePath(ctx, plan.shape, rect);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  shapePath(ctx, plan.shape, rect);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (plan.mirrored) {
    ctx.translate(rect.x + rect.size, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, src.sx, src.sy, src.sw, src.sh, 0, 0, rect.size, rect.size);
  } else {
    ctx.drawImage(image, src.sx, src.sy, src.sw, src.sh, rect.x, rect.y, rect.size, rect.size);
  }
  ctx.restore();
}
