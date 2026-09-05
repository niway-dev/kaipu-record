/**
 * Resize geometry for a selected annotation — pure, normalized (0–1) math shared by
 * the interactive layer (hit-test + live drag) and covered by unit tests.
 *
 * A selected shape shows drag handles; dragging one updates the shape's geometry:
 *   - box / blur : 8 handles (4 corners + 4 edges) that move the corresponding edges.
 *   - path       : the same 8 handles, scaling every point within the new bounding box.
 *   - arrow      : 2 handles, one per endpoint.
 *   - text       : 2 handles — the SE corner scales the font (snapping to the nearest
 *                  size level), the E edge sets the wrap width.
 */

import { TEXT_LINE_HEIGHT, TEXT_PX, textBoxPx } from "./tools";
import type { Annotation } from "./scene";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "p1" | "p2";

export interface Pt {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Handle {
  id: HandleId;
  x: number;
  y: number;
}

const WEST = new Set<HandleId>(["nw", "w", "sw"]);
const EAST = new Set<HandleId>(["ne", "e", "se"]);
const NORTH = new Set<HandleId>(["nw", "n", "ne"]);
const SOUTH = new Set<HandleId>(["sw", "s", "se"]);
const BOX_HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The mouse cursor that hints the drag axis for a handle. */
export function handleCursor(id: HandleId): string {
  if (id === "nw" || id === "se") return "nwse-resize";
  if (id === "ne" || id === "sw") return "nesw-resize";
  if (id === "n" || id === "s") return "ns-resize";
  if (id === "e" || id === "w") return "ew-resize";
  return "grab"; // arrow endpoints
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The annotation's bounding box in normalized coords, or null when it has none
 *  (e.g. an empty path). `size` is the layer's pixel size — only text needs it, since
 *  its box is derived from the rendered font size. */
export function annotationBox(a: Annotation, size: Size): Box | null {
  if (a.kind === "box" || a.kind === "blur") return { x: a.x, y: a.y, w: a.w, h: a.h };
  if (a.kind === "arrow") {
    return {
      x: Math.min(a.x1, a.x2),
      y: Math.min(a.y1, a.y2),
      w: Math.abs(a.x2 - a.x1),
      h: Math.abs(a.y2 - a.y1),
    };
  }
  if (a.kind === "path") {
    if (a.points.length === 0) return null;
    const xs = a.points.map((p) => p.x);
    const ys = a.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
  }
  // text — mirror the rendered selection outline (see Shape): when a wrap width is
  // set the box IS that width (height from the wrapped line count); otherwise width
  // from the longest line. Both in normalized space.
  const fs = TEXT_PX[a.size];
  const widthPx = a.width ? a.width * (size.w || 1) : undefined;
  const box = textBoxPx(a.text, fs, widthPx);
  const w = box.w / (size.w || 1);
  const h = box.h / (size.h || 1);
  return { x: a.x, y: a.y, w, h };
}

/** The drag handles for a selected annotation, in normalized coords. */
export function handlesFor(a: Annotation, size: Size): Handle[] {
  if (a.kind === "arrow") {
    return [
      { id: "p1", x: a.x1, y: a.y1 },
      { id: "p2", x: a.x2, y: a.y2 },
    ];
  }
  const b = annotationBox(a, size);
  if (!b) return [];
  if (a.kind === "text") {
    // Two handles: the SE corner scales the font (nearest size level), the E edge
    // sets the wrap width so the text reflows by words (Excalidraw-style).
    return [
      { id: "se", x: b.x + b.w, y: b.y + b.h },
      { id: "e", x: b.x + b.w, y: b.y + b.h / 2 },
    ];
  }
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const pos: Record<HandleId, Pt> = {
    nw: { x: b.x, y: b.y },
    n: { x: cx, y: b.y },
    ne: { x: b.x + b.w, y: b.y },
    e: { x: b.x + b.w, y: cy },
    se: { x: b.x + b.w, y: b.y + b.h },
    s: { x: cx, y: b.y + b.h },
    sw: { x: b.x, y: b.y + b.h },
    w: { x: b.x, y: cy },
    p1: { x: 0, y: 0 },
    p2: { x: 0, y: 0 },
  };
  return BOX_HANDLES.map((id) => ({ id, x: pos[id].x, y: pos[id].y }));
}

/** The resized box after dragging `handle` to point `p` (edges clamped, sign-normalized). */
function resizeBox(orig: Box, handle: HandleId, p: Pt): Box {
  let left = orig.x;
  let right = orig.x + orig.w;
  let top = orig.y;
  let bottom = orig.y + orig.h;
  if (WEST.has(handle)) left = clamp01(p.x);
  if (EAST.has(handle)) right = clamp01(p.x);
  if (NORTH.has(handle)) top = clamp01(p.y);
  if (SOUTH.has(handle)) bottom = clamp01(p.y);
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    w: Math.abs(right - left),
    h: Math.abs(bottom - top),
  };
}

/** Index of the text size whose px value is closest to `px`. */
function nearestTextLevel(px: number): number {
  let best = 0;
  let bestDelta = Infinity;
  TEXT_PX.forEach((v, i) => {
    const d = Math.abs(v - px);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  });
  return best;
}

/**
 * The geometry patch for dragging `handle` of annotation `a` to point `p`.
 * Returns a `Partial<Annotation>` to feed straight into `updateAnnotation`.
 */
export function resizeAnnotation(
  a: Annotation,
  handle: HandleId,
  p: Pt,
  size: Size,
): Partial<Annotation> {
  if (a.kind === "arrow") {
    return handle === "p1"
      ? { x1: clamp01(p.x), y1: clamp01(p.y) }
      : { x2: clamp01(p.x), y2: clamp01(p.y) };
  }
  if (a.kind === "text") {
    const fs = TEXT_PX[a.size];
    const wrapPx = a.width ? a.width * (size.w || 1) : undefined;
    if (handle === "e") {
      // The east edge sets the wrap width; the text reflows to it by words.
      const minWidth = (fs * 2) / (size.w || 1); // never collapse below ~2 glyphs
      return { width: Math.max(minWidth, clamp01(p.x) - a.x) };
    }
    // The se corner scales the font. It compares the dragged height against the
    // CURRENT box height and applies that RATIO to the font — the raw height can't
    // be the font size, because a wrapped or multi-line label is N lines tall and
    // would always map to the largest level (i.e. the handle would look dead once
    // the east edge made the text wrap).
    const origH = textBoxPx(a.text, fs, wrapPx).h || fs * TEXT_LINE_HEIGHT;
    const draggedH = (clamp01(p.y) - a.y) * (size.h || 1);
    const level = nearestTextLevel((fs * draggedH) / origH);
    if (a.width === undefined) return { size: level };
    // With a wrap width set, the width scales by the same factor so the label keeps
    // its shape instead of reflowing into a taller, narrower block.
    const minWidth = (TEXT_PX[level] * 2) / (size.w || 1);
    return {
      size: level,
      width: clamp01(Math.max(minWidth, a.width * (TEXT_PX[level] / fs))),
    };
  }
  const orig = annotationBox(a, size);
  if (!orig) return {};
  const nb = resizeBox(orig, handle, p);
  if (a.kind === "path") {
    // Scale every point from the old box into the new one (a straight axis keeps its
    // coordinate when that dimension is zero, so a flat stroke doesn't collapse to NaN).
    const points = a.points.map((pt) => ({
      x: orig.w === 0 ? nb.x : nb.x + ((pt.x - orig.x) / orig.w) * nb.w,
      y: orig.h === 0 ? nb.y : nb.y + ((pt.y - orig.y) / orig.h) * nb.h,
    }));
    return { points };
  }
  // box / blur
  return { x: nb.x, y: nb.y, w: nb.w, h: nb.h };
}

/** The handle under point `p` (within `tol` normalized units), or null. Handles are
 *  tested in order, so corners/endpoints (listed first) win ties over edges. */
export function hitHandle(handles: Handle[], p: Pt, tol: Pt): HandleId | null {
  for (const h of handles) {
    if (Math.abs(p.x - h.x) <= tol.x && Math.abs(p.y - h.y) <= tol.y) return h.id;
  }
  return null;
}
