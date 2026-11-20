import type { RecognizedWord } from "@kaipu/domain/schemas";
import type { BasePlacement } from "../annotations/scene";
import { wordBoxNorm, type PixelRect, type PixelSize } from "./geometry";

/** One recognized line: its reading-order index and the union box of its words. */
export interface LineBox {
  line: number;
  /** In the editor's world (base-normalized), like `wordBoxNorm`. */
  box: PixelRect;
}

/** How many distinct lines `words` touch: what "Copied N lines" counts. */
export function distinctLineCount(words: readonly RecognizedWord[]): number {
  return new Set(words.map((w) => w.line)).size;
}

/** The union box of each line's words, in line order. */
export function lineBoxesNorm(
  words: readonly RecognizedWord[],
  natural: PixelSize,
  basePlacement?: BasePlacement,
): LineBox[] {
  const byLine = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (const word of words) {
    const b = wordBoxNorm(word, natural, basePlacement);
    const prev = byLine.get(word.line);
    byLine.set(word.line, {
      x0: Math.min(prev?.x0 ?? b.x, b.x),
      y0: Math.min(prev?.y0 ?? b.y, b.y),
      x1: Math.max(prev?.x1 ?? b.x + b.w, b.x + b.w),
      y1: Math.max(prev?.y1 ?? b.y + b.h, b.y + b.h),
    });
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, u]) => ({ line, box: { x: u.x0, y: u.y0, w: u.x1 - u.x0, h: u.y1 - u.y0 } }));
}
