import type { RecognizedWord } from "@kaipu/domain/schemas";
import { baseFullRect, type Annotation, type BasePlacement } from "../annotations/scene";

/** A size in pixels. */
export interface PixelSize {
  w: number;
  h: number;
}
/** A point in the layer's normalized (0–1) space, the space annotations are stored in. */
export interface NormPoint {
  x: number;
  y: number;
}
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A recognized word's box in normalized (0–1) coordinates of the base image. Words are
 * stored in the image's own pixels; normalizing them puts them in the same space as the
 * annotations, so the layer draws and hit-tests them under the same pan and zoom.
 */
export function wordBoxNorm(word: RecognizedWord, natural: PixelSize): PixelRect {
  return {
    x: word.rect.x / natural.w,
    y: word.rect.y / natural.h,
    w: word.rect.w / natural.w,
    h: word.rect.h / natural.h,
  };
}

/**
 * Where every redaction sits in base-image pixels, the way the save bakes it (same rounding:
 * out to whole pixels, clamped to the image). Locked redactions count too: they are already
 * part of the stored pixels. `basePlacement` is where the whole base asset sits (a resized
 * base); the redaction is measured against that rect, never the base's crop. An invalid
 * placement fails closed: the whole image counts as redacted, so no word is offered.
 */
export function redactionRectsInPixels(
  annotations: readonly Annotation[],
  natural: PixelSize,
  basePlacement?: BasePlacement,
): PixelRect[] {
  if (natural.w <= 0 || natural.h <= 0) return [];
  let at: { x: number; y: number; w: number; h: number };
  try {
    at = baseFullRect({ basePlacement });
  } catch {
    return [{ x: 0, y: 0, w: natural.w, h: natural.h }];
  }
  const rects: PixelRect[] = [];
  for (const a of annotations) {
    if (a.kind !== "blur") continue;
    // Base-local units; with no placement the rect is the unit square and these are `a.x`, ...
    const lx = (a.x - at.x) / at.w;
    const ly = (a.y - at.y) / at.h;
    const lw = a.w / at.w;
    const lh = a.h / at.h;
    const x0 = Math.max(0, Math.floor(lx * natural.w));
    const y0 = Math.max(0, Math.floor(ly * natural.h));
    const x1 = Math.min(natural.w, Math.ceil((lx + lw) * natural.w));
    const y1 = Math.min(natural.h, Math.ceil((ly + lh) * natural.h));
    if (x1 > x0 && y1 > y0) rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return rects;
}

/**
 * The word nearest to a point, with its distance in DISPLAY pixels (0 when the point is on
 * the word). The distance is measured on screen, not in image pixels, so the "near a word"
 * tolerance feels the same at any zoom. `ordered` is returned by index.
 */
export function nearestWord(
  ordered: readonly RecognizedWord[],
  p: NormPoint,
  natural: PixelSize,
  display: PixelSize,
): { index: number; distPx: number } | null {
  let best: { index: number; distPx: number } | null = null;
  for (let i = 0; i < ordered.length; i += 1) {
    const box = wordBoxNorm(ordered[i], natural);
    const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.w)) * display.w;
    const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.h)) * display.h;
    const distPx = Math.hypot(dx, dy);
    if (best === null || distPx < best.distPx) best = { index: i, distPx };
    if (distPx === 0) break;
  }
  return best;
}

/** Words between two words of `ordered`, both included, in reading order. */
export function wordRange(
  ordered: readonly RecognizedWord[],
  a: RecognizedWord,
  b: RecognizedWord,
): RecognizedWord[] {
  const ia = ordered.indexOf(a);
  const ib = ordered.indexOf(b);
  if (ia < 0 || ib < 0) return [];
  return ordered.slice(Math.min(ia, ib), Math.max(ia, ib) + 1);
}

/**
 * A recognized text block: the words of one line as the recognizer grouped them (one Vision
 * observation on macOS), with the box that contains them, in base-image pixels. It is what
 * the redact tool hides in one click (NIW2-706).
 */
export interface TextBlock {
  line: number;
  words: RecognizedWord[];
  rect: PixelRect;
}

/** The blocks of `words`, one per line, in reading order. Empty words make no block. */
export function textBlocks(words: readonly RecognizedWord[]): TextBlock[] {
  const byLine = new Map<number, RecognizedWord[]>();
  for (const word of words) {
    const list = byLine.get(word.line);
    if (list) list.push(word);
    else byLine.set(word.line, [word]);
  }
  const blocks: TextBlock[] = [];
  for (const [line, list] of [...byLine].sort((a, b) => a[0] - b[0])) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { rect } of list) {
      x0 = Math.min(x0, rect.x);
      y0 = Math.min(y0, rect.y);
      x1 = Math.max(x1, rect.x + rect.w);
      y1 = Math.max(y1, rect.y + rect.h);
    }
    if (x1 > x0 && y1 > y0) {
      blocks.push({ line, words: list, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    }
  }
  return blocks;
}

/**
 * The block nearest to a point, with its distance in DISPLAY pixels (0 inside its box), like
 * `nearestWord`. `blocks` is returned by index.
 */
export function nearestBlock(
  blocks: readonly TextBlock[],
  p: NormPoint,
  natural: PixelSize,
  display: PixelSize,
): { index: number; distPx: number } | null {
  if (natural.w <= 0 || natural.h <= 0) return null;
  let best: { index: number; distPx: number } | null = null;
  for (let i = 0; i < blocks.length; i += 1) {
    const r = blocks[i].rect;
    const x = r.x / natural.w;
    const y = r.y / natural.h;
    const dx = Math.max(x - p.x, 0, p.x - (x + r.w / natural.w)) * display.w;
    const dy = Math.max(y - p.y, 0, p.y - (y + r.h / natural.h)) * display.h;
    const distPx = Math.hypot(dx, dy);
    if (best === null || distPx < best.distPx) best = { index: i, distPx };
    if (distPx === 0) break;
  }
  return best;
}

/** The margin a one-click redaction grows its block by: a quarter of the block's height. */
const BLOCK_MARGIN_RATIO = 0.25;
const BLOCK_MARGIN_MIN_PX = 2;
const BLOCK_MARGIN_MAX_PX = 16;

function rectsIntersect(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Far above float error at any image size, far below a pixel. */
const ROUND_TRIP_INSET_PX = 1e-3;

/**
 * A whole-pixel rect as the normalized geometry of an annotation, so that the save, the
 * preview and the text cache (`redactionRectsInPixels`, which round OUT to whole pixels) land
 * on exactly these pixels. A plain `x / w` does not: `(20/1000 + 31/1000) * 1000` is
 * `51.00000000000001`, which rounds out to 52 and reaches one pixel into a neighbour. Each
 * edge moves a thousandth of a pixel inward, so the outward rounding returns to it.
 */
export function pixelRectToNorm(r: PixelRect, natural: PixelSize): PixelRect {
  const e = ROUND_TRIP_INSET_PX;
  return {
    x: (r.x + e) / natural.w,
    y: (r.y + e) / natural.h,
    w: (r.w - 2 * e) / natural.w,
    h: (r.h - 2 * e) / natural.h,
  };
}

/**
 * The rect a one-click redaction covers, in base-image pixels: the block's box grown by a
 * small margin (antialiased edges and descenders sit just outside the recognized box), on
 * whole pixels and inside the image.
 *
 * "Hides exactly that block": the margin shrinks (half, then none) when it would reach a word
 * of another block, so the click never blurs a neighbour's word, and the save never drops one
 * from the text cache. Boxes that already overlap a neighbour's, or only share a pixel row with
 * it once rounded out to whole pixels, keep no margin and still cover that pixel: hiding the
 * clicked line fully comes first. The cache then drops that neighbour too, because a redaction
 * removes every word it touches.
 */
export function blockRedactionRect(
  block: TextBlock,
  others: readonly RecognizedWord[],
  natural: PixelSize,
): PixelRect {
  const own = new Set(block.words);
  const neighbours = others.filter((w) => !own.has(w)).map((w) => w.rect);
  const full = Math.min(
    BLOCK_MARGIN_MAX_PX,
    Math.max(BLOCK_MARGIN_MIN_PX, Math.round(block.rect.h * BLOCK_MARGIN_RATIO)),
  );
  const grow = (m: number): PixelRect => {
    const x0 = Math.max(0, Math.floor(block.rect.x - m));
    const y0 = Math.max(0, Math.floor(block.rect.y - m));
    const x1 = Math.min(natural.w, Math.ceil(block.rect.x + block.rect.w + m));
    const y1 = Math.min(natural.h, Math.ceil(block.rect.y + block.rect.h + m));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  for (const m of [full, Math.floor(full / 2)]) {
    const rect = grow(m);
    if (!neighbours.some((n) => rectsIntersect(rect, n))) return rect;
  }
  return grow(0);
}
