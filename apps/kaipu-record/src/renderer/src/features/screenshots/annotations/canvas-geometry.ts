import {
  HAND_FONT,
  stepDiameterPx,
  STROKE_WIDTHS,
  TEXT_LINE_HEIGHT,
  stepRingPx,
  resolveFontPx,
  textBoxPx,
  textLines,
} from "./tools";
import { pathControlPoints } from "./smooth";
import { measureShape } from "./measure";
import type { Annotation, CropRect } from "./scene";

/**
 * Canvas-mode geometry (NIW2-698). Annotations keep their stored shape and units
 * (normalized 0–1 of the base image) but may lie outside [0,1]. The "content box" is the
 * union of the image rect and every annotation's bounds; it is expressed as EXTENTS: how
 * far it sticks out past each side of the image, in natural px. Pure: no React, no DOM.
 */

/** An axis-aligned rect in natural px, relative to the image's top-left corner. */
export interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** How far (>= 0, whole natural px) the content box sticks out past each image side. */
export interface Extents {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const ZERO_EXTENTS: Extents = { left: 0, top: 0, right: 0, bottom: 0 };

/** Width in px of one line of text at a font size. */
export type TextMeasure = (text: string, fontPx: number) => number;

/** The cached 2D context used to measure text; `null` once we know there is none (jsdom). */
let measureCtx: CanvasRenderingContext2D | null | undefined;

function textContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    measureCtx =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** Safety margin over a measured width: the SVG export may lay glyphs out a hair wider. */
const MEASURE_MARGIN = 1.04;
/** Fixed part of the margin, as a share of the font size (about 2 px at the preset sizes). */
const MEASURE_PAD_EM = 0.08;

/**
 * Default measure: the real width of the line in the font the export draws it in (same
 * font string as the compositor's text branch: weight 600, `HAND_FONT`), plus a small
 * safety margin. A character-count estimate cuts wide glyphs off in the export, which is
 * sized from this box. Falls back to the `textBoxPx` estimate when there is no 2D
 * context (jsdom). No font-load step: `HAND_FONT` is a system stack (the Caveat face is
 * not bundled), so the canvas resolves it exactly as the SVG does.
 */
export const defaultTextMeasure: TextMeasure = (text, fontPx) => {
  const ctx = textContext();
  if (!ctx) return textBoxPx(text, fontPx).w;
  ctx.font = `600 ${fontPx}px ${HAND_FONT}`;
  return ctx.measureText(text).width * MEASURE_MARGIN + fontPx * MEASURE_PAD_EM;
};

/** Jitter amplitude of roughRect (px, not scaled), see rough.ts. */
const ROUGH_JITTER = 1.7;
/** Arrow head length in display px, see roughArrow. */
const ARROW_HEAD = 15;
/** Largest vertical bow of the arrow curve (display px): half of the 16 + 6 control offset. */
const ARROW_BOW = 11;

function grow(b: Bounds, m: number): Bounds {
  return { x1: b.x1 - m, y1: b.y1 - m, x2: b.x2 + m, y2: b.y2 + m };
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

/**
 * Where an annotation actually paints, in natural px relative to the image origin
 * (stroke, arrow head and text label included). `scale` = naturalW / displayedW, which
 * converts the display-px constants (stroke, font, head) to natural px. Null when the
 * annotation paints nothing (a pen stroke with no points).
 */
export function annotationBounds(
  a: Annotation,
  naturalW: number,
  naturalH: number,
  scale: number,
  measure: TextMeasure = defaultTextMeasure,
): Bounds | null {
  if (a.kind === "blur") {
    // A blur only paints over the image, so the part outside it adds nothing.
    const x1 = Math.max(0, a.x * naturalW);
    const y1 = Math.max(0, a.y * naturalH);
    const x2 = Math.min(naturalW, (a.x + a.w) * naturalW);
    const y2 = Math.min(naturalH, (a.y + a.h) * naturalH);
    return x2 > x1 && y2 > y1 ? { x1, y1, x2, y2 } : null;
  }
  if (a.kind === "box") {
    const m = (STROKE_WIDTHS[a.stroke] ?? STROKE_WIDTHS[0]) * scale * 0.5 + ROUGH_JITTER;
    return grow(
      {
        x1: a.x * naturalW,
        y1: a.y * naturalH,
        x2: (a.x + a.w) * naturalW,
        y2: (a.y + a.h) * naturalH,
      },
      m,
    );
  }
  if (a.kind === "arrow") {
    const x1 = a.x1 * naturalW;
    const y1 = a.y1 * naturalH;
    const x2 = a.x2 * naturalW;
    const y2 = a.y2 * naturalH;
    const sw = (STROKE_WIDTHS[a.stroke] ?? STROKE_WIDTHS[0]) * scale;
    const m = sw / 2 + 2 * scale; // half stroke + jitter on the end points
    const body = grow(
      { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) },
      m,
    );
    const head = grow({ x1: x2, y1: y2, x2, y2 }, ARROW_HEAD * scale + sw / 2);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - ARROW_BOW * scale;
    const bow = grow({ x1: mx, y1: my, x2: mx, y2: my }, 5 * scale + sw / 2);
    return union(union(body, head), bow);
  }
  if (a.kind === "path") {
    if (a.points.length === 0) return null;
    const m = ((STROKE_WIDTHS[a.stroke] ?? STROKE_WIDTHS[0]) * scale) / 2;
    // The stroke is drawn through `smoothPath`, whose curves can overshoot the stored
    // points: bound the Bézier control points instead (a cubic stays inside their hull).
    let b: Bounds | null = null;
    for (const p of pathControlPoints(
      a.points.map((q) => ({ x: q.x * naturalW, y: q.y * naturalH })),
    )) {
      const pb = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      b = b ? union(b, pb) : pb;
    }
    return b ? grow(b, m) : null;
  }
  if (a.kind === "measure") {
    // The segment, its end ticks and the label pill, in natural px.
    const s = measureShape(a, naturalW, naturalH, scale);
    const sw = (STROKE_WIDTHS[1] * scale) / 2;
    let b: Bounds = grow(
      {
        x1: Math.min(s.p1.x, s.p2.x),
        y1: Math.min(s.p1.y, s.p2.y),
        x2: Math.max(s.p1.x, s.p2.x),
        y2: Math.max(s.p1.y, s.p2.y),
      },
      sw,
    );
    for (const t of s.ticks) {
      b = union(
        b,
        grow(
          {
            x1: Math.min(t[0], t[2]),
            y1: Math.min(t[1], t[3]),
            x2: Math.max(t[0], t[2]),
            y2: Math.max(t[1], t[3]),
          },
          sw,
        ),
      );
    }
    return union(b, {
      x1: s.pill.x,
      y1: s.pill.y,
      x2: s.pill.x + s.pill.w,
      y2: s.pill.y + s.pill.h,
    });
  }
  if (a.kind === "step") {
    const d = stepDiameterPx(a.size);
    const r = ((d + stepRingPx(d)) / 2) * scale;
    return grow(
      { x1: a.x * naturalW, y1: a.y * naturalH, x2: a.x * naturalW, y2: a.y * naturalH },
      r,
    );
  }
  // text: y is the TOP (dominant-baseline hanging); a width wraps to width × naturalW.
  const fs = resolveFontPx(a.size, a.fontPx) * scale;
  const widthPx = a.width ? a.width * naturalW : undefined;
  const lines = textLines(a.text, fs, widthPx);
  const measured = lines.reduce((max, line) => Math.max(max, measure(line, fs)), 0);
  // A wrap width is the box, but a line of wide glyphs can still run past it.
  const w = widthPx ? Math.max(widthPx, measured) : measured;
  const h = lines.length * fs * TEXT_LINE_HEIGHT;
  const x = a.x * naturalW;
  const y = a.y * naturalH;
  return { x1: x, y1: y, x2: x + w, y2: y + h };
}

/** Float noise must not turn an exactly-fitting bound into a whole extra pixel. */
const EPS = 1e-6;
const over = (n: number): number => Math.max(0, Math.ceil(n - EPS));

/**
 * The content-box extents: how far the union of the image rect and every annotation's
 * bounds sticks out past each side of the image, rounded up to whole natural px.
 * All zero when everything lies inside the image.
 */
export function contentExtents(
  annotations: readonly Annotation[],
  naturalW: number,
  naturalH: number,
  scale: number,
  measure: TextMeasure = defaultTextMeasure,
): Extents {
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  for (const a of annotations) {
    const b = annotationBounds(a, naturalW, naturalH, scale, measure);
    if (!b) continue;
    left = Math.max(left, over(-b.x1));
    top = Math.max(top, over(-b.y1));
    right = Math.max(right, over(b.x2 - naturalW));
    bottom = Math.max(bottom, over(b.y2 - naturalH));
  }
  return { left, top, right, bottom };
}

export function hasExtents(e: Extents): boolean {
  return e.left > 0 || e.top > 0 || e.right > 0 || e.bottom > 0;
}

/** Extents in display px (natural / scale), for placing the background in the live view. */
export function extentsToDisplay(e: Extents, scale: number): Extents {
  const k = scale > 0 ? scale : 1;
  return { left: e.left / k, top: e.top / k, right: e.right / k, bottom: e.bottom / k };
}

export interface CanvasGeom {
  naturalW: number;
  naturalH: number;
  /** Beautify padding in natural px. */
  pad: number;
  extents: Extents;
}

export interface CanvasLayout {
  /** Whole composed frame, natural px. */
  fullW: number;
  fullH: number;
  /** Where the image's top-left sits in the frame (annotations translate by this). */
  originX: number;
  originY: number;
  /** The union box (content, excluding the padding ring) in frame px. */
  box: { x: number; y: number; w: number; h: number };
}

export function canvasLayout(g: CanvasGeom): CanvasLayout {
  const { naturalW, naturalH, pad, extents: e } = g;
  const boxW = e.left + naturalW + e.right;
  const boxH = e.top + naturalH + e.bottom;
  return {
    fullW: boxW + 2 * pad,
    fullH: boxH + 2 * pad,
    originX: pad + e.left,
    originY: pad + e.top,
    box: { x: pad, y: pad, w: boxW, h: boxH },
  };
}

/** Export frame (world-normalized, relative to the image) -> frame-normalized 0–1 CropRect. */
export function worldToFrame(frame: CropRect, g: CanvasGeom): CropRect {
  const l = canvasLayout(g);
  return {
    x: (l.originX + frame.x * g.naturalW) / l.fullW,
    y: (l.originY + frame.y * g.naturalH) / l.fullH,
    w: (frame.w * g.naturalW) / l.fullW,
    h: (frame.h * g.naturalH) / l.fullH,
  };
}

/** Frame-normalized 0–1 CropRect -> export frame (world-normalized, relative to the image). */
export function frameToWorld(crop: CropRect, g: CanvasGeom): CropRect {
  const l = canvasLayout(g);
  return {
    x: (crop.x * l.fullW - l.originX) / g.naturalW,
    y: (crop.y * l.fullH - l.originY) / g.naturalH,
    w: (crop.w * l.fullW) / g.naturalW,
    h: (crop.h * l.fullH) / g.naturalH,
  };
}

/**
 * The one rule for an export frame that ran past the composed frame: clip a
 * frame-normalized rect to [0,1]². Returns undefined when nothing is left (empty or
 * degenerate), meaning the frame is treated as absent and the whole frame is used.
 * Shared by the preview and the export so both show the same window.
 */
export function intersectFrame(c: CropRect): CropRect | undefined {
  const x1 = Math.max(0, c.x);
  const y1 = Math.max(0, c.y);
  const x2 = Math.min(1, c.x + c.w);
  const y2 = Math.min(1, c.y + c.h);
  if (!(x2 - x1 > 1e-6) || !(y2 - y1 > 1e-6)) return undefined;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
