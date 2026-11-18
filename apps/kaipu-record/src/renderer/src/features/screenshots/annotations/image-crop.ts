import { MAX_BASE_SCALE, MIN_BASE_SCALE, MIN_CROP } from "./canvas-doc";
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
 * (`scene.ts`: it stays the anchor), so it has a sentinel. The editor only generates
 * `a<number>` annotation ids, so only a hand-edited document could carry an annotation whose id
 * is "base" (the reader accepts any string id); that case would be ambiguous. Otherwise a
 * `removeAnnotation` on it finds nothing and does nothing.
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
 * The smallest crop window the document reader accepts, with a hair of margin for the float
 * noise of the divide that turns a window into a `crop` (`MIN_CROP` itself would round under it).
 */
const MIN_CROP_FRACTION = MIN_CROP * (1 + 1e-6);

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
 * (`MIN_CROP_PX` of layer px and the reader's minimum crop fraction, never past the asset's own
 * size). The other edges stay put.
 */
export function resizeCropWindow(
  win: NormalizedRect,
  full: NormalizedRect,
  handle: HandleId,
  p: Pt,
  size: Size,
): NormalizedRect {
  // The larger of the display minimum and the reader's minimum crop fraction of the asset (on a
  // scaled-up asset 24 display px can be under a thousandth of it, which the reader refuses).
  const minW = Math.min(full.w, Math.max(MIN_CROP_PX / (size.w || 1), MIN_CROP_FRACTION * full.w));
  const minH = Math.min(full.h, Math.max(MIN_CROP_PX / (size.h || 1), MIN_CROP_FRACTION * full.h));
  let left = win.x;
  let right = win.x + win.w;
  let top = win.y;
  let bottom = win.y + win.h;
  // The asset bound wins over the minimum: a stored window already below the minimum, hugging
  // the asset's edge, stays on the asset (the minimum yields) instead of leaving it.
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const fullRight = full.x + full.w;
  const fullBottom = full.y + full.h;
  if (WEST.has(handle)) left = clamp(p.x, full.x, Math.max(full.x, right - minW));
  if (EAST.has(handle)) right = clamp(p.x, Math.min(fullRight, left + minW), fullRight);
  if (NORTH.has(handle)) top = clamp(p.y, full.y, Math.max(full.y, bottom - minH));
  if (SOUTH.has(handle)) bottom = clamp(p.y, Math.min(fullBottom, top + minH), fullBottom);
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
 * Capped so the visible base never passes `MAX_BASE_SIDE_PX` and the asset's scale stays inside
 * what the document reader accepts. Null for an edge handle.
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
  // Shrink (or grow) about the corner that stays put, so a cap does not slide the picture. Two
  // caps: the visible side the export can hold, and the scale range the document reader accepts
  // (a tiny crop window enlarged a lot can ask for a whole-asset scale past it).
  const c0 = base.baseCrop;
  const scale = c0 ? w / c0.w : w;
  const longest = Math.max(w * natural.w, h * natural.h);
  let k = 1;
  if (longest > MAX_BASE_SIDE_PX) k = Math.min(k, MAX_BASE_SIDE_PX / longest);
  if (scale * k > MAX_BASE_SCALE) k = MAX_BASE_SCALE / scale;
  if (scale * k < MIN_BASE_SCALE) k = MIN_BASE_SCALE / scale;
  if (k !== 1) {
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

/** The eight handles of a crop window: four corners and four edge middles. */
export const CROP_HANDLES: readonly HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Where a handle sits on a window, in the same units as the window. */
export function cropHandlePoint(win: NormalizedRect, handle: HandleId): Pt {
  const fx = WEST.has(handle) ? 0 : EAST.has(handle) ? 1 : 0.5;
  const fy = NORTH.has(handle) ? 0 : SOUTH.has(handle) ? 1 : 0.5;
  return { x: win.x + fx * win.w, y: win.y + fy * win.h };
}

/**
 * The window handle under `p` (normalized), or null. A corner or an edge middle within `tolPx`
 * of the pointer first (corners win), then a press along an edge grabs that edge, so a thin
 * window can still be grabbed anywhere on its outline.
 */
export function cropHandleAt(
  win: NormalizedRect,
  p: Pt,
  size: Size,
  tolPx: number,
): HandleId | null {
  const px = p.x * size.w;
  const py = p.y * size.h;
  const dist = (h: HandleId): number => {
    const q = cropHandlePoint(win, h);
    return Math.hypot(q.x * size.w - px, q.y * size.h - py);
  };
  // Corners first, then edge middles: a corner wins over the edge it sits on.
  for (const h of ["nw", "ne", "se", "sw", "n", "e", "s", "w"] as const) {
    if (dist(h) <= tolPx) return h;
  }
  const left = win.x * size.w;
  const right = (win.x + win.w) * size.w;
  const top = win.y * size.h;
  const bottom = (win.y + win.h) * size.h;
  const inX = px >= left - tolPx && px <= right + tolPx;
  const inY = py >= top - tolPx && py <= bottom + tolPx;
  // The nearest edge within tolerance.
  const edges: [HandleId, number][] = [];
  if (inX) edges.push(["n", Math.abs(py - top)], ["s", Math.abs(py - bottom)]);
  if (inY) edges.push(["w", Math.abs(px - left)], ["e", Math.abs(px - right)]);
  edges.sort((a, b) => a[1] - b[1]);
  return edges.length > 0 && edges[0][1] <= tolPx ? edges[0][0] : null;
}

/**
 * An added image shown as its WHOLE asset: its full rect and no crop. What crop mode draws and
 * what the geometry measures while the crop is edited, so the window can be dragged out to the
 * asset's edge. The same object for an image with no crop.
 */
export function wholeImage(a: ImageAnnotation): ImageAnnotation {
  if (!a.crop) return a;
  const { crop: _crop, ...rest } = a;
  return { ...rest, ...fullRect(a) };
}
