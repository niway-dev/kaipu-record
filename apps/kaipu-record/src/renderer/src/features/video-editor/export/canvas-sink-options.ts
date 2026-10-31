/**
 * Canvases mediabunny's CanvasSink keeps in a ring buffer. Without a pool it allocates a new
 * full-size OffscreenCanvas for every decoded frame (~18,000 per 10 min of 30 fps 1080p).
 * Both workers compose each canvas before the next frame is pulled. The MP4 worker also
 * re-composes the PREVIOUS frame once the next one arrives (webcam fills over a still
 * screen), which the second slot keeps intact: mediabunny draws a frame into its canvas
 * only when it yields it, so with 2 slots the previous frame survives exactly one pull.
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
