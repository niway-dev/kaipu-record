/**
 * Annotation tool model — the tools, the colour palette, stroke widths, and text
 * sizes. Pure data (no React/DOM). The colours are concrete drawing values used
 * later by the canvas, so they live here as the single source of truth (the
 * accent colours intentionally mirror the brand accents).
 */

export const ANNOTATION_TOOLS = ["select", "pen", "box", "arrow", "text", "blur", "crop"] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

/**
 * Gaussian blur radius (px, in the display coordinate space) for a redaction box —
 * strong enough to make text unreadable while keeping the surrounding shape, which
 * is the point of a blur vs a solid bar. The export scales it by the same factor as
 * strokes so it matches the preview. NOTE: Gaussian blur is not cryptographically
 * secure (reversible); a destructive mosaic is the documented follow-up for true
 * redaction — see backlog/screenshot-redaction.
 */
export const BLUR_STD = 12;

export type ColorNameKey =
  | "colorPink"
  | "colorBlack"
  | "colorWhite"
  | "colorYellow"
  | "colorRed"
  | "colorGreen"
  | "colorPurple";

export interface AnnotationColor {
  /** i18n key (under the `screenshots` namespace) for this swatch's a11y name. */
  nameKey: ColorNameKey;
  value: string;
}

// Pink (the brand accent) leads, so it's the default swatch — a fresh annotation
// uses ANNOTATION_COLORS[0] (see use-annotation-tools). Black-by-default felt dull.
export const ANNOTATION_COLORS: AnnotationColor[] = [
  { nameKey: "colorPink", value: "#f6055c" },
  { nameKey: "colorBlack", value: "#1a1a1a" },
  { nameKey: "colorWhite", value: "#f5f5f5" },
  { nameKey: "colorYellow", value: "#eab308" },
  { nameKey: "colorRed", value: "#ef4444" },
  { nameKey: "colorGreen", value: "#22c55e" },
  { nameKey: "colorPurple", value: "#a855f7" },
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

/** Line-height multiple for multi-line text annotations — matches the `dy` between
 * rendered tspans and the exported SVG so preview and export never diverge. */
export const TEXT_LINE_HEIGHT = 1.3;

/**
 * The font size an annotation is drawn at, in px.
 *
 * `size` is an INDEX into TEXT_PX — the XS/S/M/L presets. `fontPx` is a free value set
 * by dragging a corner, and it wins when present, which is what makes a corner drag
 * continuous instead of snapping between four levels. Absent on every label saved
 * before corners scaled, so those keep their preset and nothing migrates.
 */
export function resolveFontPx(size: number, fontPx?: number): number {
  if (fontPx !== undefined && Number.isFinite(fontPx) && fontPx > 0) return fontPx;
  return TEXT_PX[size] ?? TEXT_PX[1]!;
}

/**
 * The display lines of a text annotation — THE entry point, deliberately the only one.
 *
 * A newline is inserted with Alt/Shift+Enter while editing (plain Enter commits). Given
 * a font size and a wrap width, lines also break by whole words to fit the box: a word
 * never splits mid-letter, and a single word wider than the box overflows on its own
 * line. Without a width it breaks only on the user's own newlines.
 *
 * This absorbed `wrapText`, which used to sit on top of it. A pair where one function
 * ignores the width is a pair a caller gets wrong, and the video editor's renderer did
 * exactly that — reaching for the narrower one and silently dropping every wrap.
 */
export function textLines(text: string, fs?: number, maxWidthPx?: number): string[] {
  const hard = text.split("\n");
  if (!fs || !maxWidthPx || maxWidthPx <= 0) return hard;
  const maxChars = Math.max(1, Math.floor(maxWidthPx / (fs * CHAR_ADVANCE)));
  const out: string[] = [];
  for (const line of hard) {
    let current = "";
    for (const word of line.split(" ")) {
      if (current === "") {
        current = word;
      } else if (`${current} ${word}`.length <= maxChars) {
        current += ` ${word}`;
      } else {
        out.push(current); // the next word does not fit — wrap, never split it
        current = word;
      }
    }
    out.push(current); // trailing content, and preserves an empty hard line
  }
  return out;
}

/** Approximate advance (px) of one glyph in the hand font at size `fs`. Used to turn
 * a pixel wrap-width into a character budget and to size the box from a line length —
 * one factor so wrapping, the box, hit-test and export all agree. */
const CHAR_ADVANCE = 0.55;

/**
 * Pixel bounds of a rendered text annotation — the single source for the selection
 * outline, the hit box, the resize handles and the export. With a wrap width the box
 * IS that width and the height comes from the wrapped line count; without one, width
 * comes from the longest line. Height always from the line count × line height.
 */
export function textBoxPx(text: string, fs: number, maxWidthPx?: number): { w: number; h: number } {
  const lines = textLines(text, fs, maxWidthPx);
  const h = lines.length * fs * TEXT_LINE_HEIGHT;
  if (maxWidthPx && maxWidthPx > 0) return { w: maxWidthPx, h };
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return { w: longest * fs * CHAR_ADVANCE, h };
}
