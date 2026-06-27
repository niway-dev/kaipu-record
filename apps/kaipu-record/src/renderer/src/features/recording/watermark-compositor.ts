import wordmarkUrl from "@renderer/assets/brand/kaipu-wordmark.svg";
import markUrl from "@renderer/assets/brand/kaipu-mark-mono.svg";
import {
  watermarkRect,
  type WatermarkConfig,
  type WatermarkVariant,
} from "@renderer/features/watermark/watermark";

const ASSET_URL: Record<WatermarkVariant, string> = {
  wordmark: wordmarkUrl,
  mark: markUrl,
};

// Fallback aspect (wordmark is 1974×352) if an SVG reports no intrinsic size.
const FALLBACK_ASPECT = 1974 / 352;

export interface WatermarkCompositor {
  /** The composited video track to encode instead of the raw screen track. */
  track: MediaStreamVideoTrack;
  stop(): void;
}

/**
 * Burn the watermark into the screen capture by compositing on a `<canvas>`: the
 * screen frame is drawn first, then the (optionally white-tinted) asset at the
 * configured corner, and the canvas is re-captured as a video track. This is the
 * `videoProvider` seam — the only path that touches every frame, so it runs ONLY
 * when the watermark is enabled (the no-watermark path stays zero-cost).
 */
export async function startWatermarkCompositor(
  screenStream: MediaStream,
  config: WatermarkConfig,
  frameRate: number,
): Promise<WatermarkCompositor> {
  const screenTrack = screenStream.getVideoTracks()[0];
  const settings = screenTrack.getSettings();
  const width = settings.width ?? 1920;
  const height = settings.height ?? 1080;

  // Hidden <video> playing the live screen capture — the compositor's input.
  const video = document.createElement("video");
  video.srcObject = new MediaStream([screenTrack]);
  video.muted = true;
  await video.play();

  // Load + (optionally) re-tint the asset once; per-frame we just blit it.
  const image = await loadImage(ASSET_URL[config.variant]);
  const aspect = image.width && image.height ? image.width / image.height : FALLBACK_ASPECT;
  const stamp = config.tint === "white" ? whiteSilhouette(image) : image;
  const rect = watermarkRect(width, height, aspect, config);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("watermark compositor: 2D canvas context unavailable");

  let frame = 0;
  const draw = (): void => {
    ctx.drawImage(video, 0, 0, width, height);
    ctx.save();
    ctx.globalAlpha = config.opacity;
    // A soft dark shadow lifts the (white) mark off light backgrounds.
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = Math.max(2, Math.round(rect.height * 0.18));
    ctx.drawImage(stamp, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
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
