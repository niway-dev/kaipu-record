import wordmarkUrl from "@renderer/assets/brand/kaipu-wordmark.svg";
import markUrl from "@renderer/assets/brand/kaipu-mark-mono.svg";
import {
  watermarkRect,
  type Rect,
  type WatermarkConfig,
  type WatermarkVariant,
} from "@renderer/features/watermark/watermark";

const ASSET_URL: Record<WatermarkVariant, string> = {
  wordmark: wordmarkUrl,
  mark: markUrl,
};

// Fallback aspect (wordmark is 1974×352) if an SVG reports no intrinsic size.
const FALLBACK_ASPECT = 1974 / 352;

export interface RecordingCompositor {
  /** The composited video track to encode instead of the raw screen track. */
  track: MediaStreamVideoTrack;
  stop(): void;
}

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
): Promise<RecordingCompositor> {
  const screenTrack = screenStream.getVideoTracks()[0];

  // Hidden <video> playing the live (native-resolution) screen capture.
  const video = document.createElement("video");
  video.srcObject = new MediaStream([screenTrack]);
  video.muted = true;
  await video.play();

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

  let frame = 0;
  const draw = (): void => {
    // Uniform scale (target keeps the source AR) → no distortion.
    ctx.drawImage(video, 0, 0, target.width, target.height);
    if (stamp && rect) {
      ctx.save();
      ctx.globalAlpha = opacity;
      // A soft dark shadow lifts the (white) mark off light backgrounds.
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = Math.max(2, Math.round(rect.height * 0.18));
      ctx.drawImage(stamp, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    }
    frame = requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(frameRate);
  const track = stream.getVideoTracks()[0];

  return {
    track,
    stop: () => {
      cancelAnimationFrame(frame);
      track.stop();
      video.pause();
      video.srcObject = null;
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
