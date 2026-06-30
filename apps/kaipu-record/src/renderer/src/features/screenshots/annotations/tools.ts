/**
 * Annotation tool model — the tools, the colour palette, stroke widths, and text
 * sizes. Pure data (no React/DOM). The colours are concrete drawing values used
 * later by the canvas, so they live here as the single source of truth (the
 * accent colours intentionally mirror the brand accents).
 */

export const ANNOTATION_TOOLS = ["select", "box", "arrow", "text"] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

export interface AnnotationColor {
  name: string;
  value: string;
}

export const ANNOTATION_COLORS: AnnotationColor[] = [
  { name: "Negro", value: "#1a1a1a" },
  { name: "Blanco", value: "#f5f5f5" },
  { name: "Rosa", value: "#f6055c" },
  { name: "Amarillo", value: "#eab308" },
  { name: "Rojo", value: "#ef4444" },
  { name: "Verde", value: "#22c55e" },
  { name: "Púrpura", value: "#a855f7" },
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
