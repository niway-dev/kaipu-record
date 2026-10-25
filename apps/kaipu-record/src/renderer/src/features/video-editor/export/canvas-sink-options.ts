/**
 * Canvases mediabunny's CanvasSink keeps in a ring buffer. Without a pool it allocates a new
 * full-size OffscreenCanvas for every decoded frame (~18,000 per 10 min of 30 fps 1080p).
 * Both workers consume each canvas synchronously (compose.clip / grab copy the pixels before
 * the next frame is pulled), so 2 is enough; the second slot is headroom.
 */
export const EXPORT_CANVAS_POOL_SIZE = 2;

export function exportCanvasSinkOptions(width: number, height: number) {
  return {
    width,
    height,
    // 'contain' letterboxes so the aspect ratio is never distorted.
    fit: "contain" as const,
    poolSize: EXPORT_CANVAS_POOL_SIZE,
  };
}
