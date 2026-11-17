import type { BeautifyState } from "../beautify/backgrounds";

/** One annotation, in the image's natural-pixel coordinate space. */
export interface BoxAnnotation {
  id: string;
  kind: "box";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  stroke: number;
  seed: number;
}
export interface ArrowAnnotation {
  id: string;
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  stroke: number;
  seed: number;
}
export interface TextAnnotation {
  id: string;
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  /** Optional wrap width in normalized (0–1) units. Set by dragging a side handle:
   * the text word-wraps to it (Excalidraw-style). Absent = auto width, so the
   * label only breaks on the user's own newlines. */
  width?: number;
  /** Free font size in px, set by dragging a corner. Wins over `size`, which is an
   * index into the S/M/L/XL presets — this is what makes a corner drag continuous
   * instead of snapping between four levels. Absent = use the preset. */
  fontPx?: number;
}
/** A freehand pen stroke: the user's captured path, smoothed at render time. */
export interface PathAnnotation {
  id: string;
  kind: "path";
  /** Normalized (0–1) points in capture order. */
  points: { x: number; y: number }[];
  color: string;
  stroke: number;
}
/** How a redaction destroys its pixels: a strong blur, or an opaque fill. */
export type RedactionStyle = "blur" | "solid";

/** A redaction box: the base image under this rect is destroyed (baked into the export). */
export interface BlurAnnotation {
  id: string;
  kind: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Absent = "blur" (the strong blur; a redaction made with the old gaussian is read as it). */
  style?: RedactionStyle;
  /** True = its pixels were baked into the stored asset by an earlier save. It is kept in
   * the document but not drawn again and not selectable. */
  locked?: boolean;
  /** Epoch ms of the save that locked it; shown as "Permanent · saved Nov 11". Absent on a
   * redaction locked before the time was recorded. */
  lockedAt?: number;
}
/**
 * Canvas mode only (NIW2-703): an image added to the canvas. Geometry is in the same
 * base-normalized units as every annotation (it may lie outside 0–1); w/h keep the image
 * at 1 world unit = 1 source px, so selection, move, delete, z-order and undo reuse the
 * annotation machinery. The base image is not one of these: it stays the anchor.
 */
export interface ImageAnnotation {
  id: string;
  kind: "image";
  /** Key into the editor's asset map and `.kaipu/<id>.assets/<assetId>.png`. */
  assetId: string;
  /** Top-left, normalized to the base image. */
  x: number;
  y: number;
  /** pixelWidth / baseNaturalW and pixelHeight / baseNaturalH. */
  w: number;
  h: number;
  pixelWidth: number;
  pixelHeight: number;
  /**
   * Non-destructive crop (per-image crop spec): the visible window INSIDE the asset,
   * normalized 0–1 of the whole asset. Absent = the whole asset. `x/y/w/h` above stay the
   * VISIBLE rect on the canvas, so selection, extents, hit-testing and gaps never see the
   * crop; `fullRect` gives the uncropped rect when the asset itself is needed.
   */
  crop?: CropRect;
  /** Corner radius of this image in SOURCE px. Absent = follows the global `beautify.radius`. */
  radius?: number;
}

/**
 * The rect the WHOLE asset covers on the canvas, in the same base-normalized units as
 * `x/y/w/h`. Without a crop it is the visible rect. With one, the visible rect is the
 * `crop` window of it, so the full rect is larger and may start left of / above the visible
 * rect. An invalid crop (non-finite, zero or negative size) throws. Anything that works on the asset's pixels (redaction baking, drawing) uses this.
 */
export function fullRect(a: ImageAnnotation): { x: number; y: number; w: number; h: number } {
  const c = a.crop;
  if (!c) return { x: a.x, y: a.y, w: a.w, h: a.h };
  // Fail closed: a crop that is not a real window cannot say where the hidden pixels are, and
  // guessing the visible rect would let a redaction over them skip the bake. Throwing stops
  // the save/export instead of writing an asset that still holds the secret.
  if (![c.x, c.y, c.w, c.h].every(Number.isFinite) || c.w <= 0 || c.h <= 0) {
    throw new RangeError(`image ${a.id}: invalid crop`);
  }
  const w = a.w / c.w;
  const h = a.h / c.h;
  return { x: a.x - c.x * w, y: a.y - c.y * h, w, h };
}

/**
 * A pinned ruler measurement (NIW2-702). Unlike the other kinds it is stored in the image's
 * SOURCE pixels, not normalized units, so the label is exact and never depends on zoom: the
 * label is always `to - from`. `from`/`to` are pixel edges along `axis` (the run covers
 * pixels `from` … `to - 1`), `at` is the pixel row (axis x) or column (axis y).
 * `imageW`/`imageH` are the pixel size of the image it was measured on, which turns those
 * pixels into the layer's normalized space; with one image per editor they also anchor it:
 * the measurement moves with the image. A multi-image canvas adds the image's id here.
 */
export interface MeasureAnnotation {
  id: string;
  kind: "measure";
  axis: "x" | "y";
  from: number;
  to: number;
  at: number;
  imageW: number;
  imageH: number;
  color: string;
}

/** A numbered step badge. Its number is NOT stored: it is the badge's 1-based position
 * among the scene's `step` annotations, so deleting one renumbers the rest. Plain
 * serializable data, like every other kind, so the canvas document (NIW2-700) can persist it. */
export interface StepAnnotation {
  id: string;
  kind: "step";
  /** CENTER of the badge, normalized like the other kinds (may exceed 0–1 in canvas mode). */
  x: number;
  y: number;
  color: string;
  /** Index into STEP_PX. */
  size: number;
}
export type Annotation =
  | BoxAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | PathAnnotation
  | BlurAnnotation
  | ImageAnnotation
  | MeasureAnnotation
  | StepAnnotation;

/**
 * The number each step badge shows: its 1-based position among the `step` annotations,
 * in array order. The single source for numbering — the live layer and the compositor
 * both read it, so deleting a badge renumbers the rest in the preview and the export.
 */
export function stepNumbers(annotations: readonly Annotation[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of annotations) {
    if (a.kind === "step") out.set(a.id, out.size + 1);
  }
  return out;
}

/**
 * A crop window over the beautified **frame** (background + padding + shot), normalized
 * 0–1 of that frame — NOT the base image. Undefined = the whole frame. This lets a crop
 * span into the padding/background (e.g. crop a padded 3:4 shot to a square).
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the WHOLE base asset sits on the canvas (per-image crop, unit 3): its top-left in the
 * same base-normalized units as every annotation, and a uniform `scale` (1 = natural size,
 * never a stretch). Absent = the identity, `{ x: 0, y: 0, scale: 1 }`. The world origin and
 * the units of every other item never move: a resized base moves only this, so no annotation
 * coordinate is rewritten.
 */
export interface BasePlacement {
  x: number;
  y: number;
  scale: number;
}

/** A rect in base-normalized world units. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rect the whole base asset covers, base-normalized: `{0, 0, 1, 1}` without a placement.
 * It does not depend on `baseCrop`, so anything that works on the base's pixels (redaction
 * baking) cannot lose the hidden part by reading a crop. An invalid placement (non-finite,
 * zero or negative scale) throws: it fails closed, like `fullRect`.
 */
export function baseFullRect(s: { basePlacement?: BasePlacement }): NormalizedRect {
  const p = s.basePlacement;
  if (!p) return { x: 0, y: 0, w: 1, h: 1 };
  if (![p.x, p.y, p.scale].every(Number.isFinite) || p.scale <= 0) {
    throw new RangeError("base: invalid placement");
  }
  return { x: p.x, y: p.y, w: p.scale, h: p.scale };
}

/**
 * The part of the base that shows: its `baseCrop` window of the whole asset rect. This is the
 * rect selection, extents and the export box see (the base's `x/y/w/h`, as for an added image).
 * Without a crop it is the whole asset rect.
 */
export function baseVisibleRect(s: {
  basePlacement?: BasePlacement;
  baseCrop?: CropRect;
}): NormalizedRect {
  const f = baseFullRect(s);
  const c = s.baseCrop;
  if (!c) return f;
  // Like `fullRect`: a crop that is not a real window throws, never a NaN or empty rect.
  if (![c.x, c.y, c.w, c.h].every(Number.isFinite) || c.w <= 0 || c.h <= 0) {
    throw new RangeError("base: invalid crop");
  }
  return { x: f.x + c.x * f.w, y: f.y + c.y * f.h, w: c.w * f.w, h: c.h * f.h };
}

/** The full editing document: beautify settings + the annotation layer. */
export interface Scene {
  beautify: BeautifyState;
  annotations: Annotation[];
  crop?: CropRect;
  /** The base's non-destructive crop: the window of the asset that shows, 0–1 of the asset. */
  baseCrop?: CropRect;
  /** The base's own corner radius in source px. Absent = follows `beautify.radius`. */
  baseRadius?: number;
  /** Where the whole base asset sits and how big it is. Absent = unmoved, natural size. */
  basePlacement?: BasePlacement;
  /**
   * Canvas mode only (NIW2-698): the export window in WORLD-normalized units — the same
   * units as annotations (relative to the base image, may exceed 0–1). The output is
   * exactly this rect in natural px; padding is not added around it. Ignored when canvas
   * mode is off, where `crop` keeps its meaning.
   */
  exportFrame?: CropRect;
}

export function sameScene(a: Scene, b: Scene): boolean {
  return (
    a.beautify === b.beautify &&
    a.annotations === b.annotations &&
    a.crop === b.crop &&
    a.exportFrame === b.exportFrame &&
    a.baseCrop === b.baseCrop &&
    a.baseRadius === b.baseRadius &&
    a.basePlacement === b.basePlacement
  );
}

/** The default crop: the whole image (used as the starting rect for the crop tool). */
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

let counter = 0;
/** A unique-enough id + stable jitter seed for a new annotation. */
export function nextAnnotationId(): { id: string; seed: number } {
  counter += 1;
  return { id: `a${counter}`, seed: (counter * 1103515245 + 12345) % 100000 };
}

/** Bump the id counter past every `a<number>` id present, so a reopened document does
 * not collide with ids it already contains. */
export function reserveAnnotationIds(annotations: readonly Annotation[]): void {
  for (const a of annotations) {
    const m = /^a(\d+)$/.exec(a.id);
    // An id too large for a safe integer would stall the counter at Infinity: skip it.
    if (m && Number.isSafeInteger(Number(m[1]))) counter = Math.max(counter, Number(m[1]));
  }
}
