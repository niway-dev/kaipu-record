/**
 * Annotation tool model — the tools, the colour palette, stroke widths, and text
 * sizes. Pure data (no React/DOM). The colours are concrete drawing values used
 * later by the canvas, so they live here as the single source of truth (the
 * accent colours intentionally mirror the brand accents).
 */

export const ANNOTATION_TOOLS = ["select", "pen", "box", "arrow", "text", "blur"] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

/**
 * Gaussian blur radius (px, in the display coordinate space) for a redaction box —
 * strong enough to make text unreadable while keeping the surrounding shape, which
 * is the point of a blur vs a solid bar. The export scales it by the same factor as
 * strokes so it matches the preview.
 */
export const BLUR_STD = 9;

export interface AnnotationColor {
  name: string;
  value: string;
}

// Pink (the brand accent) leads, so it's the default swatch — a fresh annotation
// uses ANNOTATION_COLORS[0] (see use-annotation-tools). Black-by-default felt dull.
export const ANNOTATION_COLORS: AnnotationColor[] = [
  { name: "Pink", value: "#f6055c" },
  { name: "Black", value: "#1a1a1a" },
  { name: "White", value: "#f5f5f5" },
  { name: "Yellow", value: "#eab308" },
  { name: "Red", value: "#ef4444" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
];

/** Stroke widths in px; the array index is the stored stroke level (0–2). */
export const STROKE_WIDTHS = [2, 3.4, 5.4] as const;

/** Text-size labels; the array index is the stored size level (0–3). */
export const TEXT_SIZES = ["XS", "S", "M", "L"] as const;

/**
 * Text pixel size per size index — the single source for both the inline input
 * and the rendered SVG text. Index lines up with TEXT_SIZES. Starts small (XS/S)
 * because a fresh label defaulting to a large size felt oversized.
 */
export const TEXT_PX = [14, 19, 27, 37] as const;

/**
 * The hand-drawn font stack for text annotations — single source for the live
 * preview and the export compositor so they never diverge. Single-quoted family
 * names are valid in CSS, a React `style`, and a double-quoted SVG `font-family`
 * attribute alike.
 */
export const HAND_FONT = "Caveat, 'Comic Sans MS', 'Segoe Print', cursive";
