import type { CanvasGeom } from "../annotations/canvas-geometry";
import type { CropRect } from "../annotations/scene";

/**
 * The export frame (world-normalized, relative to the image) that covers exactly the content
 * box: the visible base plus whatever sticks out past it, without the beautify padding. What "Fit
 * to content" on the export frame card sets.
 */
export function contentBoxFrame(g: CanvasGeom): CropRect {
  const { left, top, right, bottom } = g.extents;
  // The extents are measured from the VISIBLE base rect, which is the whole image unless the
  // base is cropped or resized.
  const b = g.base ?? { x1: 0, y1: 0, x2: g.naturalW, y2: g.naturalH };
  return {
    // `0 +` keeps a zero result 0, never -0 (a zero extent at the origin).
    x: 0 + (b.x1 - left) / g.naturalW,
    y: 0 + (b.y1 - top) / g.naturalH,
    w: (left + (b.x2 - b.x1) + right) / g.naturalW,
    h: (top + (b.y2 - b.y1) + bottom) / g.naturalH,
  };
}
