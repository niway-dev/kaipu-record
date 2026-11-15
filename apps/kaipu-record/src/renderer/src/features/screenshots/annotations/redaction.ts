import { annotationBox } from "./handles";
import type { Annotation, BlurAnnotation, RedactionStyle } from "./scene";

/** A redaction block is at least this many image pixels on a side. */
export const REDACTION_MIN_BLOCK_PX = 24;
/** The opaque fill of the "solid" style. */
export const REDACTION_SOLID_RGB = [26, 26, 26] as const;

/** Block size in image px: at least 24, and at least a quarter of the region's shorter side. */
export function redactionBlockSize(w: number, h: number): number {
  return Math.max(REDACTION_MIN_BLOCK_PX, Math.ceil(Math.min(w, h) / 4));
}

/** Raw RGBA pixels; structurally compatible with `ImageData`. */
export interface PixelRegion {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** For each coordinate along one axis: the two block indices to blend and the weight of the second. */
function axisSamples(
  length: number,
  block: number,
): { i0: Uint32Array; i1: Uint32Array; t: Float64Array } {
  const count = Math.ceil(length / block);
  const centers: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * block;
    centers.push(start + (Math.min(start + block, length) - start) / 2);
  }
  const i0 = new Uint32Array(length);
  const i1 = new Uint32Array(length);
  const t = new Float64Array(length);
  for (let p = 0; p < length; p++) {
    const pos = p + 0.5;
    let k = Math.min(Math.floor(p / block), count - 1);
    if (pos < centers[k] && k > 0) k -= 1;
    const next = Math.min(k + 1, count - 1);
    i0[p] = k;
    i1[p] = next;
    const span = centers[next] - centers[k];
    t[p] = span > 0 ? Math.min(1, Math.max(0, (pos - centers[k]) / span)) : 0;
  }
  return { i0, i1, t };
}

/**
 * Destroys a region in place. The output of "blur" is a function of the block averages
 * only, so the original pixels cannot be recovered from it (unlike a gaussian blur,
 * which can be partly reversed).
 */
export function redactRegion(region: PixelRegion, style: RedactionStyle): void {
  const { data, width, height } = region;
  if (width <= 0 || height <= 0) return;
  if (style === "solid") {
    for (let i = 0; i < width * height * 4; i += 4) {
      data[i] = REDACTION_SOLID_RGB[0];
      data[i + 1] = REDACTION_SOLID_RGB[1];
      data[i + 2] = REDACTION_SOLID_RGB[2];
      data[i + 3] = 255;
    }
    return;
  }
  const block = redactionBlockSize(width, height);
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const avg = new Float64Array(cols * rows * 4);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * block;
      const y0 = by * block;
      const x1 = Math.min(x0 + block, width);
      const y1 = Math.min(y0 + block, height);
      const sum = [0, 0, 0, 0];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          sum[0] += data[o];
          sum[1] += data[o + 1];
          sum[2] += data[o + 2];
          sum[3] += data[o + 3];
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const a = (by * cols + bx) * 4;
      for (let c = 0; c < 4; c++) avg[a + c] = sum[c] / n;
    }
  }
  const xs = axisSamples(width, block);
  const ys = axisSamples(height, block);
  for (let y = 0; y < height; y++) {
    const ty = ys.t[y];
    for (let x = 0; x < width; x++) {
      const tx = xs.t[x];
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top =
          avg[(ys.i0[y] * cols + xs.i0[x]) * 4 + c] * (1 - tx) +
          avg[(ys.i0[y] * cols + xs.i1[x]) * 4 + c] * tx;
        const bottom =
          avg[(ys.i1[y] * cols + xs.i0[x]) * 4 + c] * (1 - tx) +
          avg[(ys.i1[y] * cols + xs.i1[x]) * 4 + c] * tx;
        data[o + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
}

/**
 * Bakes every unlocked redaction into the PNG's pixels and returns the new PNG. With
 * nothing to redact it returns the SAME `bytes` object, untouched (one-image export
 * parity depends on that).
 */
export async function bakeRedactions(
  bytes: ArrayBuffer,
  annotations: readonly Annotation[],
): Promise<ArrayBuffer> {
  const pending = annotations.filter(
    (a): a is Extract<Annotation, { kind: "blur" }> => a.kind === "blur" && !a.locked,
  );
  if (pending.length === 0) return bytes;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    // Untouched pixels must come out as they went in: no color-space or alpha conversion.
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const { width, height } = bitmap;
  try {
    const rects = pending
      .map((a) => {
        const x0 = Math.max(0, Math.floor(a.x * width));
        const y0 = Math.max(0, Math.floor(a.y * height));
        const x1 = Math.min(width, Math.ceil((a.x + a.w) * width));
        const y1 = Math.min(height, Math.ceil((a.y + a.h) * height));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, style: a.style ?? "blur" };
      })
      .filter((r) => r.w > 0 && r.h > 0);
    if (rects.length === 0) return bytes;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.drawImage(bitmap, 0, 0);
    for (const r of rects) {
      const img = ctx.getImageData(r.x, r.y, r.w, r.h);
      redactRegion(img, r.style);
      ctx.putImageData(img, r.x, r.y);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG encoding failed");
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

/** Image bytes by asset id (PNG), as the editor holds them. */
export type CanvasAssets = Record<string, ArrayBuffer>;

/**
 * Canvas-mode redaction (NIW2-703): bakes every unlocked blur into EVERY image it
 * intersects, the base and each added image. A secret is hidden wherever it may sit on
 * disk, so z-order cannot protect it: a blur drawn under an image still destroys that
 * image's pixels. The blur rect is converted to each image's local normalized coordinates
 * (the image's own rect is the unit) and handed to `bakeRedactions`.
 *
 * An image no blur touches keeps its bytes object, and when nothing changed the same
 * `assets` object is returned too, so callers can tell "nothing to save" by identity.
 * Annotation images without bytes in `assets` are skipped: the caller reports them.
 */
export async function bakeCanvasRedactions(
  baseBytes: ArrayBuffer,
  assets: CanvasAssets,
  annotations: readonly Annotation[],
): Promise<{ base: ArrayBuffer; assets: CanvasAssets }> {
  const blurs = annotations.filter((a): a is BlurAnnotation => a.kind === "blur" && !a.locked);
  if (blurs.length === 0) return { base: baseBytes, assets };
  /** The blurs that overlap `rect` (positive area), re-expressed in its local units. */
  const localBlurs = (rect: { x: number; y: number; w: number; h: number }): BlurAnnotation[] =>
    blurs
      .filter(
        (b) =>
          b.x < rect.x + rect.w &&
          b.x + b.w > rect.x &&
          b.y < rect.y + rect.h &&
          b.y + b.h > rect.y,
      )
      .map((b) => ({
        ...b,
        x: (b.x - rect.x) / rect.w,
        y: (b.y - rect.y) / rect.h,
        w: b.w / rect.w,
        h: b.h / rect.h,
      }));
  // The base is the unit rect: its local coordinates are the stored ones.
  const base = await bakeRedactions(baseBytes, localBlurs({ x: 0, y: 0, w: 1, h: 1 }));
  // One asset can sit on the canvas twice: both placements' blurs apply to its bytes.
  const perAsset = new Map<string, BlurAnnotation[]>();
  for (const a of annotations) {
    if (a.kind !== "image" || !assets[a.assetId]) continue;
    perAsset.set(a.assetId, [...(perAsset.get(a.assetId) ?? []), ...localBlurs(a)]);
  }
  let next = assets;
  for (const [assetId, local] of perAsset) {
    const bytes = assets[assetId];
    const baked = await bakeRedactions(bytes, local);
    if (baked === bytes) continue;
    if (next === assets) next = { ...assets };
    next[assetId] = baked;
  }
  return { base, assets: next };
}

/**
 * Whether `box` (normalized) lies entirely inside the union of `covers`. Cuts the plane along
 * every edge involved and checks that each cell inside the box sits inside some cover, so two
 * redactions drawn side by side count together.
 */
function coveredByUnion(
  box: { x: number; y: number; w: number; h: number },
  covers: readonly { x: number; y: number; w: number; h: number }[],
): boolean {
  if (box.w <= 0 || box.h <= 0) return false;
  const cut = (lo: number, hi: number, edges: number[]): number[] =>
    [lo, hi, ...edges.filter((e) => e > lo && e < hi)].sort((a, b) => a - b);
  const xs = cut(
    box.x,
    box.x + box.w,
    covers.flatMap((c) => [c.x, c.x + c.w]),
  );
  const ys = cut(
    box.y,
    box.y + box.h,
    covers.flatMap((c) => [c.y, c.y + c.h]),
  );
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      const inside = covers.some((c) => cx > c.x && cx < c.x + c.w && cy > c.y && cy < c.y + c.h);
      if (!inside) return false;
    }
  }
  return true;
}

/**
 * The annotations a canvas document may store: every text annotation that redactions drawn
 * AFTER it cover entirely is left out. The redaction hides it on screen and in the saved PNG,
 * but the document would keep its characters as plain JSON, so "hidden" would not hold for
 * the file. Locked redactions count (their pixels are already stored). Text that a redaction
 * covers only in part stays: some of it is visible. A text drawn after a redaction sits on
 * top of it and stays too.
 *
 * `size` is the displayed image size in px, which text boxes are measured against; without
 * it nothing can be judged covered, so everything is kept. The scene itself is untouched:
 * moving or deleting the redaction in the same session brings the text back on the next save.
 */
export function withoutRedactedText(
  annotations: readonly Annotation[],
  size: { w: number; h: number },
): Annotation[] {
  if (!(size.w > 0) || !(size.h > 0)) return [...annotations];
  return annotations.filter((a, i) => {
    if (a.kind !== "text") return true;
    const box = annotationBox(a, size);
    if (!box) return true;
    const covers = annotations.slice(i + 1).filter((b): b is BlurAnnotation => b.kind === "blur");
    return !coveredByUnion(box, covers);
  });
}
