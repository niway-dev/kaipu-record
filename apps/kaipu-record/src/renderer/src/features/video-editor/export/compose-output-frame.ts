/**
 * One composed OUTPUT frame, shared by the MP4 export worker and the GIF worker (NIW2-217)
 * so the two can never diverge on what reaches the file — privacy redactions above all.
 *
 *   fill black → planClipFrame → direct draw, or (work canvas: frame → redactions →
 *   content-pinned overlays → camera crop) → overlays on the output for direct frames
 *   → framing (fixed-canvas presets: the composed view onto the target canvas, Fit/Fill)
 *   → webcam layer (ADR 0038), on the final canvas, at its size.
 *
 * Slides: fill black → contained bitmap → overlays → framing (always Fit). No webcam.
 *
 * The webcam is drawn last and on the FINAL canvas so the zoom moves the content under it
 * and Fill never crops it. A frame with no zoom and no region still takes the "direct"
 * path; the webcam is one more draw on top of it.
 *
 * Background (NIW2-668, ADR 0051): with a preset set, everything above is the PICTURE and is
 * composed onto a picture canvas instead of the output; the last step then fills the output
 * with the preset's paint and draws the picture inset, rounded and shadowed
 * (`backgroundFrame`). So the zoom, redactions, annotations, cursor and webcam all stay inside
 * the picture, the padding is never zoomed or cropped, and the output size never changes.
 * Without a background none of this runs: no picture canvas is allocated and the draw calls
 * are exactly the ones above. The paint and the shadow are the same in every frame, so they are
 * rendered ONCE into a cached backdrop canvas per (output size, background, picture rect) and
 * each frame blits it (`createBackdrops`): measured without a GPU the per-frame fill and
 * Gaussian blur cost 15 ms at 1080p and 27 ms at 1440p, over the 16.7 ms a 60 fps frame has.
 *
 * WORKER-BUNDLE INVARIANT: same as compose-frame.ts — no DOM, no React. OffscreenCanvas only.
 */
import { prepareCursor, drawCursor, type CursorLayerData } from "../cursor/cursor-model";
import {
  backgroundFrame,
  hasBackground,
  type BackgroundFrame,
  type Rect,
  type VideoBackground,
} from "../background";
import { backgroundPaint, type BackgroundPaint } from "../../screenshots/beautify/backgrounds";
import type { CameraPathMessage } from "./export-messages";
import type { OverlayWindow } from "./export-plan";
import type { Redaction } from "../privacy/redaction";
import type { WebcamScene } from "../webcam/webcam-model";
import { cameraAt } from "../zoom/camera-path";
import {
  drawWebcamLayer,
  planWebcamDraw,
  type WebcamCtx,
  type WebcamLayerFrame,
} from "./compose-webcam";
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
  cursor?: CursorLayerData | null;
  redactions: Redaction[];
  overlayWindows: OverlayWindow[];
  /** Rasterized overlay bitmaps at output size, by overlay id. */
  overlayBitmaps: Map<string, ImageBitmap>;
  /**
   * Fixed-canvas presets (Vertical, Square): `ctx` draws on `view`, a source-size canvas,
   * which is then framed onto `ctx`/`width`/`height` here. Null composes straight onto `ctx`.
   */
  framing?: OutputFraming | null;
  /** The webcam layer (ADR 0038); null for a recording without a webcam track. */
  webcam?: WebcamScene | null;
  /**
   * The background around the picture (ADR 0051), drawn last on the output. Null, absent or
   * `none` composes exactly as before (stored padding, radius and shadow are never drawn).
   */
  background?: VideoBackground | null;
}

export interface OutputFraming {
  /** The canvas the composer's `ctx` draws on. */
  view: OffscreenCanvas;
  /** The target canvas, at the preset's size. */
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  /** Fit or Fill for clip frames; slides are always Fit. */
  mode: "fit" | "fill";
  padding: "black" | "blur";
}

export interface OutputComposer {
  /**
   * Compose a decoded clip frame (`frame` already scaled to `width × height`) whose source
   * span is [sourceTs, sourceTs + sourceDuration), at output (timeline) time `outTs`, with
   * the webcam frame for it (null: none there, or no webcam). The layer's layout and the
   * camera scale it shrinks with are read at the webcam frame's own `sourceTs`.
   *
   * `cameraTs` re-composes a held frame at a later source time (a webcam fill over a still
   * screen, E9): the zoom crop follows the camera there, so it moves with the face's shrink,
   * while the redactions stay the held frame's own — they are burned in before the crop, in
   * source pixels, so the crop time cannot move them. Defaults to `sourceTs`.
   */
  clip(
    frame: CanvasImageSource,
    sourceTs: number,
    sourceDuration: number,
    outTs: number,
    webcam?: WebcamLayerFrame | null,
    cameraTs?: number,
  ): void;
  /** Compose a slide frame at output time `outTs`; a missing bitmap renders black. */
  slide(bitmap: ImageBitmap | undefined, outTs: number): void;
}

/** A canvas the picture is composed on before the background goes around it. */
interface Surface {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
}

function createSurface(width: number, height: number): Surface {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("export: no 2D context on the picture canvas");
  return { canvas, ctx, width, height };
}

/** `rect` on whole pixels (left/top/right/bottom rounded), so the picture's edge is crisp. */
function snapRect(rect: Rect): Rect {
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  return {
    x: left,
    y: top,
    width: Math.max(1, Math.round(rect.x + rect.width) - left),
    height: Math.max(1, Math.round(rect.y + rect.height) - top),
  };
}

/**
 * Fills the whole `width × height` canvas with a preset's paint: flat for a solid one, and for a
 * gradient the CSS `linear-gradient(135deg, from, to)` the preview shows (its isolines are
 * perpendicular to the diagonal, so the end colours meet exactly at the two corners whatever
 * the aspect).
 */
function paintBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  paint: BackgroundPaint,
  width: number,
  height: number,
): void {
  if (paint.kind === "none") return;
  if (paint.kind === "solid") {
    ctx.fillStyle = paint.color;
  } else {
    const reach = (width + height) / 4;
    const gradient = ctx.createLinearGradient(
      width / 2 - reach,
      height / 2 - reach,
      width / 2 + reach,
      height / 2 + reach,
    );
    gradient.addColorStop(0, paint.from);
    gradient.addColorStop(1, paint.to);
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, width, height);
}

/**
 * The part of the background that no frame changes: the output filled with the preset's paint
 * and the picture's shadow on it. The shadow is the screenshot editor's (`shadowCss`'s formula,
 * offset down and blurred, no spread). A canvas shadow follows the clip, so it is drawn BEFORE
 * the clip: the caster is drawn one canvas-width off to the left with the shadow offset bringing
 * the shadow back, which leaves the shadow alone on the canvas and nothing painted under the
 * picture.
 */
function drawBackdrop(
  ctx: OffscreenCanvasRenderingContext2D,
  dest: Rect,
  frame: BackgroundFrame,
  paint: BackgroundPaint,
  width: number,
  height: number,
): void {
  paintBackground(ctx, paint, width, height);
  if (!frame.shadow) return;
  const reach = width * 2;
  ctx.save();
  ctx.shadowColor = `rgba(0, 0, 0, ${frame.shadow.alpha})`;
  ctx.shadowBlur = frame.shadow.blur;
  ctx.shadowOffsetX = reach;
  ctx.shadowOffsetY = frame.shadow.offsetY;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(dest.x - reach, dest.y, dest.width, dest.height, frame.radius);
  ctx.fill();
  ctx.restore();
}

/**
 * The picture onto the output, over the backdrop: the picture clipped to its rounded rect.
 */
function drawPicture(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  dest: Rect,
  frame: BackgroundFrame,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(dest.x, dest.y, dest.width, dest.height, frame.radius);
  ctx.clip();
  // Downscaling the composed picture into the padding: the same high-quality resampling the
  // framer and the zoom crop use.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, dest.x, dest.y, dest.width, dest.height);
  ctx.restore();
}

/**
 * The cached backdrops of one composer, one per picture rect (a Fill clip and a Fit slide of a
 * fixed-canvas preset have two). A backdrop is the output size, opaque, and exactly what
 * `drawBackdrop` paints, so blitting it at 0,0 leaves the same pixels as painting afresh. The
 * key carries everything it depends on — output size, preset, picture rect, radius, shadow — so
 * a different size or background can never get another's layer; a composer's own inputs are
 * fixed, so in practice a composer holds one or two. Built on first use: a plain scene, whose
 * composer never asks, allocates none.
 */
function createBackdrops(
  output: { width: number; height: number },
  background: VideoBackground,
  paint: BackgroundPaint,
  frame: BackgroundFrame,
): (dest: Rect) => OffscreenCanvas {
  const layers = new Map<string, OffscreenCanvas>();
  const { shadow } = frame;
  return (dest) => {
    const key = [
      output.width,
      output.height,
      background.bg,
      dest.x,
      dest.y,
      dest.width,
      dest.height,
      frame.radius,
      shadow ? `${shadow.offsetY},${shadow.blur},${shadow.alpha}` : "no-shadow",
    ].join("|");
    const cached = layers.get(key);
    if (cached) return cached;
    // Bounded: a composer asks for at most Fit and Fill, but never keep a stale layer around.
    if (layers.size >= 2) layers.clear();
    const surface = createSurface(output.width, output.height);
    drawBackdrop(surface.ctx, dest, frame, paint, output.width, output.height);
    layers.set(key, surface.canvas);
    return surface.canvas;
  };
}

export function createOutputComposer(opts: OutputComposerOptions): OutputComposer {
  const { width, height, camera, redactions, overlayWindows, overlayBitmaps } = opts;
  const framing = opts.framing ?? null;
  const webcam = opts.webcam ?? null;
  const cursorAt = opts.cursor ? prepareCursor(opts.cursor.track, opts.cursor.settings) : null;
  // The canvas the finished frame is written to: the target for fixed-canvas presets, else
  // the output `opts.ctx` itself.
  const output = framing
    ? { ctx: framing.ctx, width: framing.width, height: framing.height }
    : { ctx: opts.ctx, width, height };
  // The background (ADR 0051): null unless a preset is set, and then nothing below changes
  // for a plain scene — no surface is allocated and every draw goes where it always went.
  const background = opts.background && hasBackground(opts.background) ? opts.background : null;
  const frame = background ? backgroundFrame(background, output.width, output.height) : null;
  const paint = background ? backgroundPaint(background.bg) : null;
  const backdropFor =
    background && frame && paint ? createBackdrops(output, background, paint, frame) : null;
  // Output-sized presets: the picture is composed on its own canvas, then drawn inset.
  const picture = background && !framing ? createSurface(width, height) : null;
  // `ctx` is where the clip pipeline draws: the picture canvas under a background, the view
  // canvas for fixed-canvas presets, else the output.
  const ctx = picture ? picture.ctx : opts.ctx;
  const framer =
    framing && !background
      ? createFramer({
          ctx: framing.ctx,
          width: framing.width,
          height: framing.height,
          padding: framing.padding,
        })
      : null;
  // Fixed-canvas presets under a background: the view is framed (Fit/Fill) into the box the
  // padding leaves, onto a "card" canvas of exactly that size, so the cursor and the webcam are
  // laid out against the picture and not against the letterbox, and the radius and the shadow
  // belong to the picture itself. One card per mode (slides are always Fit).
  const cards = new Map<"fit" | "fill", { surface: Surface; rect: Rect }>();
  const cardFor = (mode: "fit" | "fill"): { surface: Surface; rect: Rect } => {
    const cached = cards.get(mode);
    if (cached) return cached;
    const box = frame!.box;
    const fitted = framingRect(width, height, box.width, box.height, mode);
    const rect = snapRect({
      x: box.x + fitted.dx,
      y: box.y + fitted.dy,
      width: fitted.dw,
      height: fitted.dh,
    });
    const card = { surface: createSurface(rect.width, rect.height), rect };
    cards.set(mode, card);
    return card;
  };
  // Where the finished frame lives: the target canvas for fixed-canvas presets, else `ctx`.
  const final: { ctx: OffscreenCanvasRenderingContext2D; width: number; height: number } = framing
    ? { ctx: framing.ctx, width: framing.width, height: framing.height }
    : { ctx, width, height };
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

  // Clip frames: frame → redactions → overlays → crop, onto `ctx` (the view or the output).
  const composeClip = (
    frameCanvas: CanvasImageSource,
    sourceTs: number,
    sourceDuration: number,
    outTs: number,
    cameraTs: number,
  ): void => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const frame = planClipFrame(
      camera,
      redactions,
      sourceTs,
      sourceDuration,
      width,
      height,
      cameraTs,
    );
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
      // A zoom crop upscales: high-quality resampling, as the fixed-canvas framer does.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const { sx, sy, sw, sh } = frame.crop;
      ctx.drawImage(work, sx, sy, sw, sh, 0, 0, width, height);
    } else {
      ctx.drawImage(work, 0, 0);
    }
  };

  // The pipeline's picture reaches its final canvas — where the cursor and the webcam are drawn.
  // Fixed-canvas presets frame the view there (the target, or under a background the card).
  const frameInto = (mode: "fit" | "fill"): typeof final => {
    if (!framing) return final;
    if (!frame) {
      framer!.frame(framing.view, mode);
      return final;
    }
    const { surface } = cardFor(mode);
    const rect = framingRect(width, height, surface.width, surface.height, mode);
    surface.ctx.imageSmoothingEnabled = true;
    surface.ctx.imageSmoothingQuality = "high";
    surface.ctx.drawImage(
      framing.view,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      0,
      0,
      surface.width,
      surface.height,
    );
    return surface;
  };
  // The last step (ADR 0051): the background fills the output and the finished picture goes on
  // it, inset. A plain scene has no `frame` and nothing happens.
  const placePicture = (mode: "fit" | "fill"): void => {
    if (!frame || !backdropFor) return;
    const source = picture ? picture.canvas : cardFor(mode).surface.canvas;
    const dest = picture ? snapRect(frame.picture) : cardFor(mode).rect;
    // The cached paint and shadow replace the output (they are opaque and output-sized), then
    // the picture goes on them.
    output.ctx.drawImage(backdropFor(dest), 0, 0);
    drawPicture(output.ctx, source, dest, frame);
  };

  return {
    clip(frameCanvas, sourceTs, sourceDuration, outTs, webcamFrame, cameraTs = sourceTs) {
      composeClip(frameCanvas, sourceTs, sourceDuration, outTs, cameraTs);
      const mode = framing?.mode ?? "fit";
      const target = frameInto(mode);
      if (cursorAt) {
        const cam = camera ? cameraAt(camera, cameraTs) : { cx: 0.5, cy: 0.5, scale: 1 };
        const privateFrame = redactions.some(
          (r) => r.start < sourceTs + sourceDuration && r.end >= sourceTs,
        );
        const pointer = privateFrame ? null : cursorAt(cameraTs, cam, width, height, redactions);
        if (pointer && framing) {
          const rect = framingRect(width, height, target.width, target.height, framing.mode);
          const transform = (p: { x: number; y: number }) => ({
            x: rect.dx + ((p.x - rect.sx) / rect.sw) * rect.dw,
            y: rect.dy + ((p.y - rect.sy) / rect.sh) * rect.dh,
          });
          Object.assign(pointer, transform(pointer));
          if (pointer.click) Object.assign(pointer.click, transform(pointer.click));
          pointer.size = (opts.cursor!.settings.size * rect.dh) / 1080;
          target.ctx.save();
          target.ctx.beginPath();
          target.ctx.rect(rect.dx, rect.dy, rect.dw, rect.dh);
          target.ctx.clip();
          drawCursor(target.ctx, pointer);
          target.ctx.restore();
        } else drawCursor(target.ctx, pointer);
      }
      // Last, on the final canvas: after the crop and after the framer (ADR 0038).
      if (webcamFrame) {
        const at = webcamFrame.sourceTs;
        const plan = planWebcamDraw(
          webcam,
          at,
          target,
          camera ? cameraAt(camera, at).scale : 1,
          webcamFrame.image,
        );
        if (plan) {
          drawWebcamLayer(target.ctx as unknown as WebcamCtx, webcamFrame.image.image, plan);
        }
      }
      // After the webcam, and only under a background: the picture shrinks into its padding.
      placePicture(mode);
    },
    slide(bitmap, outTs) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (bitmap) drawContained(ctx, bitmap, width, height);
      stampOverlays(outTs, ctx);
      // Slides are always contained ("fit"), never cropped, whatever the clip framing.
      frameInto("fit");
      placePicture("fit");
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
 *
 * A slide bitmap is usually a different size from the frame, so this resamples — up, on a
 * 4K YouTube export. The context default is bilinear ("low"), which softens slide text;
 * "high" is the same resampling the framer and the zoom crop use. The state is left set:
 * every drawImage on this context is a resample that wants it.
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
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
