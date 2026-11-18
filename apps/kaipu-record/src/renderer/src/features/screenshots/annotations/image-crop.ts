import { MAX_EXPORT_SIDE } from "./canvas-geometry";
import { resizeAnnotation, type HandleId, type Pt, type Size } from "./handles";
import {
  baseFullRect,
  baseVisibleRect,
  fullRect,
  type Annotation,
  type BasePlacement,
  type CropRect,
  type ImageAnnotation,
  type NormalizedRect,
  type Scene,
} from "./scene";

/**
 * Per-image crop, unit 4 (pure, no React). The crop MODE edits one image's crop window; the
 * helpers here are the math the layer and the page share: which asset is being cropped, how a
 * dragged handle moves the window, how the window becomes a `crop`, and how a proportional
 * resize of the base becomes a `basePlacement`.
 */

/**
 * The id the base image answers to for selection and crop mode. The base is not an annotation
 * (`scene.ts`: it stays the anchor), so it has a sentinel; no annotation id looks like this
 * (`a<number>`), and a `removeAnnotation` on it finds nothing and does nothing.
 */
export const BASE_IMAGE_ID = "base";

/** The base's own fields on the scene: the three a crop or a resize writes. */
export type BaseFields = Pick<Scene, "baseCrop" | "baseRadius" | "basePlacement">;

/** True when the base is cropped, resized, moved or has its own corner radius. */
export function hasBaseView(b: BaseFields): boolean {
  return b.baseCrop !== undefined || b.baseRadius !== undefined || b.basePlacement !== undefined;
}

/** The smallest a crop window may be, on its shorter side, in layer (display) px. */
export const MIN_CROP_PX = 24;

/**
 * The longest visible side the base may be resized to, in source px. The reader refuses a base
 * past `MAX_EXPORT_SIDE` and an export frame past it too (padding and content come on top), so
 * the handles stop at half of it: always a frame the compositor can still produce.
 */
export const MAX_BASE_SIDE_PX = MAX_EXPORT_SIDE / 2;

/** An asset being cropped: the whole asset's rect and the window that shows, world-normalized. */
export interface CropTarget {
  id: string;
  /** Where the whole asset sits on the canvas. */
  full: NormalizedRect;
  /** The window of it that shows (the committed crop). */
  win: NormalizedRect;
}

/**
 * What crop mode edits for `id`: the base (`BASE_IMAGE_ID`) or an added image. Null when there
 * is no such image. A crop that is not a real window throws, like `fullRect` does (fail closed).
 */
export function cropTarget(
  id: string,
  annotations: readonly Annotation[],
  base: BaseFields,
): CropTarget | null {
  if (id === BASE_IMAGE_ID) {
    return { id, full: baseFullRect(base), win: baseVisibleRect(base) };
  }
  const a = annotations.find((x): x is ImageAnnotation => x.id === id && x.kind === "image");
  if (!a) return null;
  return { id, full: fullRect(a), win: { x: a.x, y: a.y, w: a.w, h: a.h } };
}

const WEST = new Set<HandleId>(["nw", "w", "sw"]);
const EAST = new Set<HandleId>(["ne", "e", "se"]);
const NORTH = new Set<HandleId>(["nw", "n", "ne"]);
const SOUTH = new Set<HandleId>(["sw", "s", "se"]);

/**
 * The crop window after dragging `handle` to `p`: each edge the handle owns follows the
 * pointer, clamped to the asset (the window never leaves it) and to a minimum size
 * (`MIN_CROP_PX` of layer px, never past the asset's own size). The other edges stay put.
 */
export function resizeCropWindow(
  win: NormalizedRect,
  full: NormalizedRect,
  handle: HandleId,
  p: Pt,
  size: Size,
): NormalizedRect {
  const minW = Math.min(full.w, MIN_CROP_PX / (size.w || 1));
  const minH = Math.min(full.h, MIN_CROP_PX / (size.h || 1));
  let left = win.x;
  let right = win.x + win.w;
  let top = win.y;
  let bottom = win.y + win.h;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  if (WEST.has(handle)) left = clamp(p.x, full.x, right - minW);
  if (EAST.has(handle)) right = clamp(p.x, left + minW, full.x + full.w);
  if (NORTH.has(handle)) top = clamp(p.y, full.y, bottom - minH);
  if (SOUTH.has(handle)) bottom = clamp(p.y, top + minH, full.y + full.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Float noise must not turn a window that covers the asset into a stored crop. */
const WHOLE_EPS = 1e-6;

/**
 * A window as the `crop` it stores: 0–1 of the asset. Undefined when the window covers the
 * whole asset (no crop to keep, so the document writes none).
 */
export function windowToCrop(full: NormalizedRect, win: NormalizedRect): CropRect | undefined {
  const crop = {
    x: (win.x - full.x) / full.w,
    y: (win.y - full.y) / full.h,
    w: win.w / full.w,
    h: win.h / full.h,
  };
  const whole =
    Math.abs(crop.x) < WHOLE_EPS &&
    Math.abs(crop.y) < WHOLE_EPS &&
    Math.abs(crop.w - 1) < WHOLE_EPS &&
    Math.abs(crop.h - 1) < WHOLE_EPS;
  return whole ? undefined : crop;
}

/** True when two windows are the same rect (a crop session that changed nothing commits nothing). */
export function sameWindow(a: NormalizedRect, b: NormalizedRect): boolean {
  return (
    Math.abs(a.x - b.x) < WHOLE_EPS &&
    Math.abs(a.y - b.y) < WHOLE_EPS &&
    Math.abs(a.w - b.w) < WHOLE_EPS &&
    Math.abs(a.h - b.h) < WHOLE_EPS
  );
}

/** The patch that commits `win` as an added image's crop: the visible rect and the window. */
export function imageCropPatch(target: CropTarget, win: NormalizedRect): Partial<ImageAnnotation> {
  return {
    x: win.x,
    y: win.y,
    w: win.w,
    h: win.h,
    crop: windowToCrop(target.full, win),
  };
}

/**
 * The base as an image annotation, for the machinery that resizes images (`resizeImage`,
 * `handlesFor`, hit-testing, the selection chrome): its VISIBLE rect, its crop and the asset's
 * pixel size. Never stored, never in the scene.
 */
export function baseAsImage(base: BaseFields, natural: { w: number; h: number }): ImageAnnotation {
  const vis = baseVisibleRect(base);
  return {
    id: BASE_IMAGE_ID,
    kind: "image",
    assetId: BASE_IMAGE_ID,
    x: vis.x,
    y: vis.y,
    w: vis.w,
    h: vis.h,
    pixelWidth: natural.w,
    pixelHeight: natural.h,
    ...(base.baseCrop ? { crop: base.baseCrop } : {}),
  };
}

/**
 * The placement the base gets from dragging a corner: a proportional resize through
 * `resizeImage` (the opposite corner stays put, the crop window keeps its aspect), turned
 * from the visible rect it patches into the whole asset's rect. The crop is not touched: it
 * is unitless, so it follows the scale and widening it later brings the hidden pixels back.
 * Capped so the visible base never passes `MAX_BASE_SIDE_PX`. Null for an edge handle.
 */
export function resizeBasePlacement(
  base: BaseFields,
  handle: HandleId,
  p: Pt,
  size: Size,
  natural: { w: number; h: number },
): BasePlacement | null {
  const img = baseAsImage(base, natural);
  const patch = resizeAnnotation(img, handle, p, size, true) as Partial<ImageAnnotation>;
  if (patch.x === undefined || patch.y === undefined) return null;
  let { x, y, w, h } = patch as { x: number; y: number; w: number; h: number };
  const longest = Math.max(w * natural.w, h * natural.h);
  if (longest > MAX_BASE_SIDE_PX) {
    // Shrink about the corner that stays put, so the cap does not slide the picture.
    const k = MAX_BASE_SIDE_PX / longest;
    const east = handle === "ne" || handle === "se";
    const south = handle === "sw" || handle === "se";
    const nw = w * k;
    const nh = h * k;
    x = east ? x : x + w - nw;
    y = south ? y : y + h - nh;
    w = nw;
    h = nh;
  }
  const c = base.baseCrop;
  const fw = c ? w / c.w : w;
  const fh = c ? h / c.h : h;
  // Uniform by construction (the ratio is the window's own); `scale` follows the width.
  return { x: c ? x - c.x * fw : x, y: c ? y - c.y * fh : y, scale: fw };
}
