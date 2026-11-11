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
/** A redaction box: the base image under this rect is blurred (baked into the export). */
export interface BlurAnnotation {
  id: string;
  kind: "blur";
  x: number;
  y: number;
  w: number;
  h: number;
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

/** The full editing document: beautify settings + the annotation layer. */
export interface Scene {
  beautify: BeautifyState;
  annotations: Annotation[];
  crop?: CropRect;
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
    a.exportFrame === b.exportFrame
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
