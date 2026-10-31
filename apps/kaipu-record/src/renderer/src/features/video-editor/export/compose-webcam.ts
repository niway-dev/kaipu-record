/**
 * The webcam layer on an exported frame (ADR 0038): the last composition step, drawn onto
 * the OUTPUT canvas after the camera path's crop and, for fixed-canvas presets, after the
 * framer, so the zoom moves the content under it and Fill never crops it.
 *
 * The geometry is the preview's own (`webcam-layout.ts`): `webcamAt` picks the layout in
 * force at the frame's source time, `webcamRect` places it in the output frame with the
 * camera path's scale for "shrink during zoom", and `webcamSourceRect` is the window of the
 * webcam image that the preview's `object-fit: cover` + `framingTransform` shows.
 *
 *   shadow (the shape filled, shadowed) → clip(shape) → (mirror) → drawImage(window → box)
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free.
 */
import {
  type CameraBubbleShape,
  cameraCornerRadiusPx,
  cameraShapeAspect,
} from "@shared/camera-bubble";
import {
  type FrameSize,
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

/**
 * The webcam frame for one output frame, with the screen SOURCE time it stands for: the
 * layer's layout and the camera scale are read at that time, the same one the frame was
 * picked at, so all three agree (a clip's straddling first frame uses the clip's start).
 */
export interface WebcamLayerFrame {
  image: WebcamImage;
  sourceTs: number;
}

export interface WebcamDrawPlan {
  /** The bubble's box in the output frame. */
  rect: WebcamRect;
  /** The window of the (unmirrored) webcam image drawn into it. */
  src: { sx: number; sy: number; sw: number; sh: number };
  mirrored: boolean;
  shape: CameraBubbleShape;
  /** The square's and the rectangle's corner, a share of the shorter side (ADR 0041). */
  cornerRadius: number;
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
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    rect,
    src: webcamSourceRect(image, layout.framing, layout.mirrored, cameraShapeAspect(layout.shape)),
    mirrored: layout.mirrored,
    shape: layout.shape,
    cornerRadius: layout.cornerRadius,
    shadow: layout.shadow,
  };
}

function shapePath(ctx: WebcamCtx, plan: WebcamDrawPlan): void {
  const { x, y, width, height } = plan.rect;
  ctx.beginPath();
  if (plan.shape === "circle") {
    ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
  } else {
    const r = cameraCornerRadiusPx(plan.shape, plan.cornerRadius, width, height);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
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
    ctx.shadowBlur = WEBCAM_SHADOW.blur * rect.height;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = WEBCAM_SHADOW.offsetY * rect.height;
    ctx.fillStyle = "#000";
    shapePath(ctx, plan);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  shapePath(ctx, plan);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (plan.mirrored) {
    ctx.translate(rect.x + rect.width, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, src.sx, src.sy, src.sw, src.sh, 0, 0, rect.width, rect.height);
  } else {
    ctx.drawImage(image, src.sx, src.sy, src.sw, src.sh, rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
}
