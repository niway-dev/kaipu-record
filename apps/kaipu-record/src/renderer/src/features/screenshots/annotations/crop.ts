/**
 * Pure crop-rect helpers. A crop is a normalized box; its editing (resize/move) reuses
 * the annotation resize geometry in `handles.ts` through a box adapter, so there's one
 * source of truth for handle math. All values are 0–1 of the base image.
 */

import { handlesFor, hitHandle, resizeAnnotation, type Handle, type HandleId, type Pt, type Size } from "./handles";
import { FULL_CROP, type CropRect } from "./scene";

const MIN = 0.02; // smallest crop side (2% of the image) so it can't collapse

/** True when the crop covers (essentially) the whole image. */
export function isFullCrop(c: CropRect): boolean {
  const e = 0.001;
  return c.x <= e && c.y <= e && c.w >= 1 - e && c.h >= 1 - e;
}

/** Clamp a crop into the canvas with a minimum size. */
export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN, c.w));
  const h = Math.min(1, Math.max(MIN, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

/** Translate a crop by (dx,dy), keeping it fully inside the canvas (size preserved). */
export function moveCrop(c: CropRect, dx: number, dy: number): CropRect {
  const x = Math.min(1 - c.w, Math.max(0, c.x + dx));
  const y = Math.min(1 - c.h, Math.max(0, c.y + dy));
  return { x, y, w: c.w, h: c.h };
}

/** Wrap a crop as a box-shaped annotation so `handles.ts` can operate on it. */
function asBox(c: CropRect) {
  return { id: "crop", kind: "box", x: c.x, y: c.y, w: c.w, h: c.h, color: "#000", stroke: 0, seed: 0 } as const;
}

/** The 8 resize handles for a crop rect. */
export function cropHandles(c: CropRect, size: Size): Handle[] {
  return handlesFor(asBox(c), size);
}

/** The handle under a point, or null. */
export function hitCropHandle(c: CropRect, p: Pt, tol: Pt, size: Size): HandleId | null {
  return hitHandle(cropHandles(c, size), p, tol);
}

/** Resize a crop by dragging `handle` to point `p`, clamped to the canvas. */
export function resizeCrop(c: CropRect, handle: HandleId, p: Pt, size: Size): CropRect {
  // resizeAnnotation returns Partial<Annotation> (a union partial); for a box it is
  // {x,y,w,h}. Read it through an explicit shape so the union types don't fight us.
  const patch = resizeAnnotation(asBox(c), handle, p, size) as unknown as {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
  return clampCrop({ x: patch.x ?? c.x, y: patch.y ?? c.y, w: patch.w ?? c.w, h: patch.h ?? c.h });
}

export { FULL_CROP };
