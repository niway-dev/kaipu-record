/**
 * One composed OUTPUT frame, shared by the MP4 export worker and the GIF worker (NIW2-217)
 * so the two can never diverge on what reaches the file — privacy redactions above all.
 *
 *   fill black → planClipFrame → direct draw, or (work canvas: frame → redactions →
 *   content-pinned overlays → camera crop) → overlays on the output for direct frames.
 *
 * Slides: fill black → contained bitmap → overlays.
 *
 * WORKER-BUNDLE INVARIANT: same as compose-frame.ts — no DOM, no React. OffscreenCanvas only.
 */
import type { CameraPathMessage } from "./export-messages";
import type { OverlayWindow } from "./export-plan";
import type { Redaction } from "../privacy/redaction";
import {
  applyRedactions,
  framingRect,
  planClipFrame,
  type Ctx2D,
  type ScratchCanvas,
} from "./compose-frame";

export interface OutputComposerOptions {
  /** The output canvas context; frames are composed onto it at `width × height`. */
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  camera: CameraPathMessage | null;
  redactions: Redaction[];
  overlayWindows: OverlayWindow[];
  /** Rasterized overlay bitmaps at output size, by overlay id. */
  overlayBitmaps: Map<string, ImageBitmap>;
}

export interface OutputComposer {
  /**
   * Compose a decoded clip frame (`frame` already scaled to `width × height`) whose source
   * span is [sourceTs, sourceTs + sourceDuration), at output (timeline) time `outTs`.
   */
  clip(frame: CanvasImageSource, sourceTs: number, sourceDuration: number, outTs: number): void;
  /** Compose a slide frame at output time `outTs`; a missing bitmap renders black. */
  slide(bitmap: ImageBitmap | undefined, outTs: number): void;
}

export function createOutputComposer(opts: OutputComposerOptions): OutputComposer {
  const { ctx, width, height, camera, redactions, overlayWindows, overlayBitmaps } = opts;
  // v2 composition resources (plans/video-editor-v2/11): a source-resolution work canvas
  // for redactions + content-pinned overlays before the camera crop, and a scratch canvas
  // for mosaics. The work canvas is created lazily — a recording with no zoom and no region
  // never allocates it; the mosaic scratch stays 1×1 until a pixelated region resizes it.
  let work: OffscreenCanvas | null = null;
  let workCtx: OffscreenCanvasRenderingContext2D | null = null;
  const scratch = new OffscreenCanvas(1, 1);
  const filterSupported = canvasFilterSupported();

  // Stamp any overlay whose visibility window covers `outTs`. Clip frames that are
  // composited stamp onto the work canvas instead, BEFORE the crop, so overlays are
  // content-pinned.
  const stampOverlays = (outTs: number, target: OffscreenCanvasRenderingContext2D): void => {
    for (const window of overlayWindows) {
      if (outTs < window.start || outTs > window.end) continue;
      const bitmap = overlayBitmaps.get(window.overlayId);
      if (bitmap) target.drawImage(bitmap, 0, 0, width, height);
    }
  };

  return {
    clip(frameCanvas, sourceTs, sourceDuration, outTs) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      const frame = planClipFrame(camera, redactions, sourceTs, sourceDuration, width, height);
      if (frame.mode === "direct") {
        // Unchanged pre-v2 path: no zoom and no privacy region on this frame.
        ctx.drawImage(frameCanvas, 0, 0);
        stampOverlays(outTs, ctx);
        return;
      }
      if (!work || !workCtx) {
        work = new OffscreenCanvas(width, height);
        workCtx = work.getContext("2d");
        if (!workCtx) throw new Error("export: no 2D context on the work canvas");
      }
      workCtx.filter = "none";
      workCtx.drawImage(frameCanvas, 0, 0);
      // Source = `work` itself, NOT the decoded frame: regions may overlap, and a blur
      // sampling the decoded frame would paint blurred original pixels over a cover drawn
      // before it. Self-drawImage is legal in Canvas2D.
      applyRedactions(
        workCtx as unknown as Ctx2D,
        work,
        frame.redactions,
        width,
        height,
        scratch as unknown as ScratchCanvas,
        filterSupported,
      );
      stampOverlays(outTs, workCtx);
      if (frame.crop) {
        ctx.imageSmoothingQuality = "high";
        const { sx, sy, sw, sh } = frame.crop;
        ctx.drawImage(work, sx, sy, sw, sh, 0, 0, width, height);
      } else {
        ctx.drawImage(work, 0, 0);
      }
    },
    slide(bitmap, outTs) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (bitmap) drawContained(ctx, bitmap, width, height);
      stampOverlays(outTs, ctx);
    },
  };
}

/**
 * Whether `ctx.filter` blurs on this platform's OffscreenCanvas 2D. Checked once per
 * export; when false, gaussian regions fall back to the mosaic (applyRedactions), so a
 * region is never left unredacted.
 */
function canvasFilterSupported(): boolean {
  try {
    const src = new OffscreenCanvas(3, 1);
    const sctx = src.getContext("2d");
    const dst = new OffscreenCanvas(3, 1);
    const dctx = dst.getContext("2d");
    if (!sctx || !dctx) return false;
    sctx.fillStyle = "#fff";
    sctx.fillRect(1, 0, 1, 1);
    dctx.filter = "blur(1px)";
    if (dctx.filter !== "blur(1px)") return false;
    dctx.drawImage(src, 0, 0);
    // A working blur spreads the middle white pixel into its neighbours.
    return dctx.getImageData(0, 0, 1, 1).data[3] > 0;
  } catch {
    return false;
  }
}

/**
 * Draw `bitmap` into `(w × h)` with letterboxing (contain), centred, on a
 * black background that was already filled by the caller.
 */
function drawContained(
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export interface FrameIntoOptions {
  /** The target-size output context. */
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  /** What fills the canvas around a Fit frame (NIW2-218 Q2). */
  padding: "black" | "blur";
}

/**
 * NIW2-218 fixed-canvas presets: places a composed VIEW (source-size canvas that already
 * holds frame → redactions → content-pinned overlays → zoom crop) onto the target canvas.
 * Privacy is decided upstream, on the view; this step only scales and crops it, so a
 * redaction always stays on the same content pixels.
 *
 * The blurred padding is a downscale → upscale of the view itself (cheap, needs no canvas
 * filter support), dimmed so the real frame reads as the subject.
 */
export function createFramer(opts: FrameIntoOptions): {
  frame(view: OffscreenCanvas, mode: "fit" | "fill"): void;
} {
  const { ctx, width, height, padding } = opts;
  // ~1/24 of the canvas: upscaling it back with smoothing reads as a strong blur.
  const tiny = new OffscreenCanvas(
    Math.max(2, Math.round(width / 24)),
    Math.max(2, Math.round(height / 24)),
  );
  const tinyCtx = tiny.getContext("2d");
  return {
    frame(view, mode) {
      const rect = framingRect(view.width, view.height, width, height, mode);
      const covers = rect.dx <= 0 && rect.dy <= 0 && rect.dw >= width && rect.dh >= height;
      if (!covers) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        if (padding === "blur" && tinyCtx) {
          const cover = framingRect(view.width, view.height, tiny.width, tiny.height, "fill");
          tinyCtx.imageSmoothingEnabled = true;
          tinyCtx.drawImage(
            view,
            cover.sx,
            cover.sy,
            cover.sw,
            cover.sh,
            0,
            0,
            tiny.width,
            tiny.height,
          );
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(tiny, 0, 0, width, height);
          ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
          ctx.fillRect(0, 0, width, height);
        }
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(view, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
    },
  };
}
