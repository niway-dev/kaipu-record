import wordmarkUrl from "@renderer/assets/brand/kaipu-wordmark.svg";
import markUrl from "@renderer/assets/brand/kaipu-mark-mono.svg";
import {
  watermarkRect,
  type Rect,
  type WatermarkConfig,
  type WatermarkVariant,
} from "@renderer/features/watermark/watermark";
import { playWithin } from "./frame-size";

const ASSET_URL: Record<WatermarkVariant, string> = {
  wordmark: wordmarkUrl,
  mark: markUrl,
};

// Fallback aspect (wordmark is 1974×352) if an SVG reports no intrinsic size.
const FALLBACK_ASPECT = 1974 / 352;

export interface RecordingCompositor {
  /** The composited video track to encode instead of the raw screen track. */
  track: MediaStreamVideoTrack;
  /** Stop redrawing (the take is paused). Idempotent. */
  pause(): void;
  /** Redraw once and follow the source again. No-op after `stop()`. */
  resume(): void;
  stop(): void;
}

// A static screen produces no source frames, and captureStream only emits when the canvas
// changes, so redraw at least this often to keep the encoder fed.
const HEARTBEAT_MS = 1000;
// Tick faster than the bound: a 1 s tick that skips because a frame drew 500 ms earlier
// would leave a ~2 s gap. A 250 ms tick keeps every gap under HEARTBEAT_MS + 250 ms.
const HEARTBEAT_TICK_MS = 250;
// rVFC is not proven to fire on a detached <video> in a hidden window: with no source
// frame by then, follow the display (rAF) instead, throttled the same way.
const FRAME_CALLBACK_GRACE_MS = 500;

/**
 * Re-frame the screen capture onto a `<canvas>` sized to `target` and re-capture
 * it as the video track to encode. Two jobs in one pass:
 *
 * 1. **Correct, undistorted downscale.** The screen is captured at its NATIVE
 *    resolution (see the engine); drawing it into `target` — whose dimensions
 *    preserve the source aspect ratio (`fitToCap`) — is a *uniform* scale, so the
 *    image is never stretched. This is what fixes the 16:9-box squeeze on
 *    non-16:9 panels (every MacBook).
 * 2. **Optional watermark.** When `watermark` is set, the asset is burned into the
 *    corner after the frame is drawn.
 *
 * The engine runs this only when a resize and/or a watermark is needed; a native
 * frame that already matches `target` with no watermark is encoded raw (zero
 * added cost).
 */
export async function startRecordingCompositor(
  screenStream: MediaStream,
  target: { width: number; height: number },
  watermark: WatermarkConfig | null,
  frameRate: number,
  /**
   * A recording area (ADR 0030): the physical pixels of the track to draw. Fixed for the
   * whole take; without it the whole frame is drawn, re-read every frame as before.
   */
  sourceRect?: Rect,
): Promise<RecordingCompositor> {
  const screenTrack = screenStream.getVideoTracks()[0];

  // Hidden <video> playing the live (native-resolution) screen capture.
  const video = document.createElement("video");
  video.srcObject = new MediaStream([screenTrack]);
  video.muted = true;
  try {
    // Capped: a track with no frame fails the start instead of hanging it.
    await playWithin(video);
  } catch (error) {
    video.srcObject = null;
    throw error;
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("recording compositor: 2D canvas context unavailable");
  // High-quality resampling for the native → target downscale (sharper text).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Prepare the watermark stamp + placement once; per-frame we just blit it.
  let stamp: CanvasImageSource | null = null;
  let rect: Rect | null = null;
  let opacity = 1;
  if (watermark) {
    const image = await loadImage(ASSET_URL[watermark.variant]);
    const aspect = image.width && image.height ? image.width / image.height : FALLBACK_ASPECT;
    stamp = watermark.tint === "white" ? whiteSilhouette(image) : image;
    rect = watermarkRect(target.width, target.height, aspect, watermark);
    opacity = watermark.opacity;
  }

  // Cadence: one draw per NEW source frame, never faster than the capture rate.
  // `requestVideoFrameCallback` fires only when the <video> presents a new frame; without
  // it, fall back to rAF, throttled by the same interval. The 2 ms slack keeps a 30 fps
  // source on a 60 Hz clock from skipping every other frame.
  const minIntervalMs = 1000 / Math.max(1, frameRate) - 2;
  let hasVideoFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let handle = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let paused = false;
  let stopped = false;
  let lastDrawAt = Number.NEGATIVE_INFINITY;
  let sourceFrames = 0;
  let draws = 0;
  const startedAt = performance.now();

  /**
   * `at` is the time the draw is charged to: the callback's frame time when a frame drives
   * it. Stamping the clock after the draw instead would carry the draw's own cost into the
   * interval, and on a 60 Hz clock a 5 ms draw would then skip to every third frame (20 fps).
   */
  const draw = (at = performance.now()): void => {
    // Screen sources have a fixed AR, but WINDOW sources change dimensions
    // whenever the user resizes the window — re-reading videoWidth/videoHeight
    // and uniformly fitting (letterboxed, never stretched) every frame keeps the
    // output correct even if the source's AR drifts from `target`'s mid-recording,
    // instead of stretching the current frame into the fixed target box.
    const sx = sourceRect?.x ?? 0;
    const sy = sourceRect?.y ?? 0;
    const vw = sourceRect?.width ?? (video.videoWidth || target.width);
    const vh = sourceRect?.height ?? (video.videoHeight || target.height);
    const fit = Math.min(target.width / vw, target.height / vh);
    const dw = vw * fit;
    const dh = vh * fit;
    const dx = (target.width - dw) / 2;
    const dy = (target.height - dh) / 2;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(video, sx, sy, vw, vh, dx, dy, dw, dh);
    if (stamp && rect) {
      ctx.save();
      ctx.globalAlpha = opacity;
      // A soft dark shadow lifts the (white) mark off light backgrounds.
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = Math.max(2, Math.round(rect.height * 0.18));
      ctx.drawImage(stamp, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    }
    lastDrawAt = at;
    draws += 1;
  };
  const onFrame = (now: number): void => {
    sourceFrames += 1;
    if (stopped || paused) return;
    if (now - lastDrawAt >= minIntervalMs) draw(now);
    schedule();
  };
  const schedule = (): void => {
    handle = hasVideoFrameCallback
      ? video.requestVideoFrameCallback(onFrame)
      : requestAnimationFrame(onFrame);
  };
  const halt = (): void => {
    if (hasVideoFrameCallback) video.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
    clearInterval(heartbeat);
    clearTimeout(grace);
  };
  const start = (): void => {
    schedule();
    heartbeat = setInterval(() => {
      if (performance.now() - lastDrawAt >= HEARTBEAT_MS) draw();
    }, HEARTBEAT_TICK_MS);
    if (hasVideoFrameCallback && sourceFrames === 0) {
      grace = setTimeout(() => {
        if (sourceFrames > 0) return;
        video.cancelVideoFrameCallback(handle);
        hasVideoFrameCallback = false;
        schedule();
      }, FRAME_CALLBACK_GRACE_MS);
    }
  };

  draw(); // the first frame must exist before captureStream is created
  start();

  const stream = canvas.captureStream(frameRate);
  const track = stream.getVideoTracks()[0];

  return {
    track,
    pause: () => {
      if (paused || stopped) return;
      paused = true;
      halt();
    },
    resume: () => {
      if (!paused || stopped) return;
      paused = false;
      draw();
      start();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      halt();
      track.stop();
      video.pause();
      video.srcObject = null;
      // One line per take to check the cadence (draws/s should stay at or under frameRate).
      const seconds = (performance.now() - startedAt) / 1000;
      if (seconds > 0) {
        console.info(
          `[recording-compositor] ${draws} draws, ${sourceFrames} source frames in ${seconds.toFixed(1)}s ` +
            `(${(draws / seconds).toFixed(1)} draws/s, cap ${frameRate}) via ${hasVideoFrameCallback ? "requestVideoFrameCallback" : "requestAnimationFrame"}`,
        );
      }
    },
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`watermark: failed to load ${src}`));
    image.src = src;
  });
}

/** Re-colour the asset to a solid white silhouette, preserving its alpha. */
function whiteSilhouette(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width || 1974;
  canvas.height = image.height || 352;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
