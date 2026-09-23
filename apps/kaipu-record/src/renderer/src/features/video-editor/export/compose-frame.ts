/**
 * Per-frame composition for the export worker (plans/video-editor-v2/11), split out of
 * export-worker.ts so it is unit-testable with a fake 2D context. Order, identical to the
 * preview's DOM layering (doc 09):
 *
 *   decoded source frame → privacy regions → content-pinned overlays → camera crop
 *
 * Everything before the crop happens at SOURCE resolution on a scratch canvas, so a
 * redaction always covers the same pixels whatever the zoom does afterwards.
 *
 * WORKER-BUNDLE INVARIANT: nothing reachable from this module may touch the DOM or React.
 * It reaches ../zoom/camera-path (→ `@shared/cursor-track`) and ../privacy/redaction; both
 * are pure and DOM-free, and both aliases are declared for the worker bundle in
 * `electron.vite.config.ts`. Importing anything DOM-bound here fails at runtime inside the
 * worker, not at build time.
 */
import { type CameraPath, cameraAt, cropRect, isIdentity } from "../zoom/camera-path";
import {
  blurSigmaPx,
  coverLabelColor,
  coverLabelPx,
  pixelBlockPx,
  rectToPx,
  type Redaction,
  redactionsForFrame,
} from "../privacy/redaction";

/** The subset of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D used here. */
export interface Ctx2D {
  filter: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
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

/** A resizable canvas for the mosaic downscale (an OffscreenCanvas in the worker). */
export interface ScratchCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Ctx2D | null;
}

export interface CropPx {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface ClipFramePlan {
  /** "direct": no zoom and no region → draw the frame as-is (today's path, zero cost). */
  mode: "direct" | "composite";
  /** Source-pixel window to scale onto the output; null = whole frame. */
  crop: CropPx | null;
  redactions: Redaction[];
}

export function cropRectPx(
  camera: { cx: number; cy: number; scale: number },
  width: number,
  height: number,
): CropPx {
  const r = cropRect(camera);
  // The simulation already clamps the window inside the frame, but the path is stored as
  // Float32: a rounded edge can land a fraction of a pixel outside, and drawImage with an
  // out-of-bounds source rect samples transparent black (a black hairline on the export).
  const sx = Math.max(0, r.x * width);
  const sy = Math.max(0, r.y * height);
  return {
    sx,
    sy,
    sw: Math.min(width - sx, r.w * width),
    sh: Math.min(height - sy, r.h * height),
  };
}

/**
 * What to do with one decoded clip frame on screen during source
 * [frameStart, frameStart + frameDuration).
 */
export function planClipFrame(
  camera: CameraPath | null,
  redactions: Redaction[],
  frameStart: number,
  frameDuration: number,
  width: number,
  height: number,
): ClipFramePlan {
  const active = redactionsForFrame(redactions, frameStart, frameStart + frameDuration);
  const cam = camera ? cameraAt(camera, frameStart) : null;
  const crop = cam && !isIdentity(cam) ? cropRectPx(cam, width, height) : null;
  return { mode: crop || active.length > 0 ? "composite" : "direct", crop, redactions: active };
}

/**
 * Burn `redactions` into `ctx` at source resolution. `source` is the canvas `ctx` itself
 * draws on (self-drawImage is legal in Canvas2D): every region samples the pixels COMPOSED
 * SO FAR, not the decoded original, so a blur stacked on an earlier cover re-blurs the
 * cover instead of re-revealing what it hid. Regions may overlap (doc 06). A blur on a
 * platform without canvas filters falls back to the mosaic — never to an unredacted region.
 */
export function applyRedactions(
  ctx: Ctx2D,
  source: CanvasImageSource,
  redactions: Redaction[],
  width: number,
  height: number,
  scratch: ScratchCanvas,
  canvasFilterSupported: boolean,
): void {
  for (const r of redactions) {
    const px = rectToPx(r.rect, width, height);
    if (px.w === 0 || px.h === 0) continue;

    if (r.kind === "cover") {
      ctx.fillStyle = r.fill;
      ctx.fillRect(px.x, px.y, px.w, px.h);
      if (r.label) {
        ctx.fillStyle = coverLabelColor(r.fill);
        ctx.font = `600 ${coverLabelPx(height)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Inset relative to the label size (≈ the preview's 4 px padding at the 382 px
        // reference height), so it holds at any resolution instead of vanishing at 4K.
        const maxWidth = Math.max(1, px.w - coverLabelPx(height) * 0.8);
        ctx.fillText(r.label, px.x + px.w / 2, px.y + px.h / 2, maxWidth);
      }
      continue;
    }

    if (r.style === "gaussian" && canvasFilterSupported) {
      const sigma = blurSigmaPx(r.intensity, height);
      // Sample a margin around the region so the blur doesn't fade to transparent at
      // its edge; the clip keeps the result inside the region.
      const m = Math.ceil(sigma * 3);
      const x0 = Math.max(0, px.x - m);
      const y0 = Math.max(0, px.y - m);
      const x1 = Math.min(width, px.x + px.w + m);
      const y1 = Math.min(height, px.y + px.h + m);
      ctx.save();
      ctx.beginPath();
      ctx.rect(px.x, px.y, px.w, px.h);
      ctx.clip();
      // FAIL CLOSED against the frame borders. The 3σ margin is clamped at the frame edge,
      // so for a region flush against a border the filtered draw's own alpha fade lands
      // INSIDE the clip — drawn source-over onto a canvas that already holds the unblurred
      // frame, the original would show through in that band. Painting the region opaque
      // first means whatever the fade lets through blends against a solid block.
      ctx.filter = "none";
      ctx.fillStyle = "#18181b";
      ctx.fillRect(px.x, px.y, px.w, px.h);
      ctx.filter = `blur(${sigma}px)`;
      ctx.drawImage(source, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
      continue;
    }

    // Pixelate (or gaussian fallback): average down into cells, scale back up unsmoothed.
    const cell = pixelBlockPx(r.intensity, height);
    const cols = Math.max(1, Math.ceil(px.w / cell));
    const rows = Math.max(1, Math.ceil(px.h / cell));
    scratch.width = cols;
    scratch.height = rows;
    const sctx = scratch.getContext("2d");
    if (!sctx) {
      // No scratch context: fail CLOSED with a solid block rather than leak the region.
      ctx.fillStyle = "#18181b";
      ctx.fillRect(px.x, px.y, px.w, px.h);
      continue;
    }
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(source, px.x, px.y, px.w, px.h, 0, 0, cols, rows);
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      scratch as unknown as CanvasImageSource,
      0,
      0,
      cols,
      rows,
      px.x,
      px.y,
      px.w,
      px.h,
    );
    ctx.imageSmoothingEnabled = smoothing;
  }
}
