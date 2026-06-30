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
export type Annotation =
  | BoxAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | PathAnnotation
  | BlurAnnotation;

/** The full editing document: beautify settings + the annotation layer. */
export interface Scene {
  beautify: BeautifyState;
  annotations: Annotation[];
}

export function sameScene(a: Scene, b: Scene): boolean {
  return a.beautify === b.beautify && a.annotations === b.annotations;
}

let counter = 0;
/** A unique-enough id + stable jitter seed for a new annotation. */
export function nextAnnotationId(): { id: string; seed: number } {
  counter += 1;
  return { id: `a${counter}`, seed: (counter * 1103515245 + 12345) % 100000 };
}
