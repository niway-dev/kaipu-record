/**
 * GIF encoding core (NIW2-217): a shared global palette, frame differencing and a streaming
 * writer on top of `gifenc`. Pure (no DOM, no canvas) so it runs in the GIF worker and in
 * vitest on synthetic RGBA arrays.
 *
 * Size strategy (spec § Technical considerations):
 * - ONE global palette (`buildGlobalPalette`) quantized from a handful of frames sampled
 *   across the range. Index 255 is reserved for transparency and never produced by
 *   `applyPalette`, because the quantizer only gets 255 slots.
 * - Frame differencing: after the first frame, a pixel within `DIFF_TOLERANCE` of what the
 *   viewer currently shows (the last EMITTED value at that position) is written as the
 *   transparent index, and the frame is cropped to the bounding box of changed pixels.
 *   Disposal 1 ("do not dispose") keeps everything underneath on screen. A frame with no
 *   change at all is folded into the previous frame's delay.
 *
 * gifenc always writes left/top = 0 in the image descriptor, so cropped frames are encoded
 * by a second encoder in manual mode and their descriptor offset is patched in place
 * (`patchImageOffset`) before the bytes are appended to the output.
 */
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export type Palette = number[][];

/** Reserved palette slot for "unchanged, show what's underneath". */
export const TRANSPARENT_INDEX = 255;
/** Max per-channel delta still treated as "unchanged" (absorbs decoder noise). */
export const DIFF_TOLERANCE = 4;
/** Disposal method 1: leave the frame in place; the next one draws on top of it. */
const DISPOSE_NONE = 1;
/** Header (6) + logical screen descriptor (7) + 256-colour table (768) + NETSCAPE2.0 (19). */
export const GIF_HEADER_BYTES = 800;
/** The trailer byte. */
export const GIF_TRAILER_BYTES = 1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Quantizes the concatenation of `samples` (RGBA, any sizes) to at most 255 colours.
 * Returns the colours `applyPalette` may map to (never index 255).
 */
export function buildGlobalPalette(samples: ArrayLike<number>[]): Palette {
  const total = samples.reduce((sum, s) => sum + s.length, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const s of samples) {
    all.set(s, offset);
    offset += s.length;
  }
  const colors = quantize(all, TRANSPARENT_INDEX, { format: "rgb565" });
  return colors.length > 0 ? colors : [[0, 0, 0]];
}

/** The palette written to the file: `colors` padded to 256 entries (slot 255 = transparent). */
export function filePalette(colors: Palette): Palette {
  const padded = colors.slice(0, TRANSPARENT_INDEX);
  while (padded.length < 256) padded.push([0, 0, 0]);
  return padded;
}

/**
 * Bounding box of the pixels of `next` that differ from `shown` by more than `tolerance`
 * on any RGB channel (alpha is ignored — composed frames are opaque). Null = no change.
 */
export function changedBounds(
  shown: ArrayLike<number>,
  next: ArrayLike<number>,
  width: number,
  height: number,
  tolerance = DIFF_TOLERANCE,
): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    let row = y * width * 4;
    for (let x = 0; x < width; x++, row += 4) {
      if (
        Math.abs(shown[row] - next[row]) > tolerance ||
        Math.abs(shown[row + 1] - next[row + 1]) > tolerance ||
        Math.abs(shown[row + 2] - next[row + 2]) > tolerance
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Copies the `rect` sub-image of a `width`-wide RGBA buffer into a tight RGBA buffer. */
export function cropRgba(rgba: ArrayLike<number>, width: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const src = ((rect.y + y) * width + rect.x) * 4;
    const row = rect.width * 4;
    for (let i = 0; i < row; i++) out[y * row + i] = rgba[src + i];
  }
  return out;
}

/**
 * Palette indices for `rect` of `next`, with every pixel the viewer would see unchanged
 * written as TRANSPARENT_INDEX. Mutates `shown` / `shownIndex` to the post-frame state.
 * Returns null when every pixel ends up transparent (nothing visible changes).
 */
export function diffIndices(
  shown: Uint8Array | Uint8ClampedArray,
  shownIndex: Uint8Array,
  next: ArrayLike<number>,
  width: number,
  rect: Rect,
  colors: Palette,
  tolerance = DIFF_TOLERANCE,
): Uint8Array | null {
  const index = applyPalette(cropRgba(next, width, rect), colors, "rgb565");
  let visible = false;
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const i = y * rect.width + x;
      const p = (rect.y + y) * width + (rect.x + x);
      const o = p * 4;
      const same =
        Math.abs(shown[o] - next[o]) <= tolerance &&
        Math.abs(shown[o + 1] - next[o + 1]) <= tolerance &&
        Math.abs(shown[o + 2] - next[o + 2]) <= tolerance;
      if (same || index[i] === shownIndex[p]) {
        index[i] = TRANSPARENT_INDEX;
        continue;
      }
      visible = true;
      shownIndex[p] = index[i];
      shown[o] = next[o];
      shown[o + 1] = next[o + 1];
      shown[o + 2] = next[o + 2];
    }
  }
  return visible ? index : null;
}

/** Writes `x`/`y` into the image descriptor of a manual-mode gifenc frame (GCE first). */
export function patchImageOffset(frame: Uint8Array, x: number, y: number): void {
  // Graphic control extension = 8 bytes, then 0x2C, then left (u16 LE), top (u16 LE).
  if (frame[8] !== 0x2c) throw new Error("gif-encode: unexpected frame layout");
  frame[9] = x & 0xff;
  frame[10] = (x >> 8) & 0xff;
  frame[11] = y & 0xff;
  frame[12] = (y >> 8) & 0xff;
}

interface PendingFrame {
  bytes: Uint8Array | null; // null = the first (full) frame, written by the main encoder
  index: Uint8Array;
  rect: Rect;
  delayCs: number;
  first: boolean;
}

/**
 * Streaming GIF writer: feed composed RGBA frames in order, get the file bytes at the end.
 * Each frame is buffered until the next one arrives so an unchanged frame can extend its
 * delay instead of being written.
 */
export class GifStreamWriter {
  private readonly main = GIFEncoder({ initialCapacity: 1 << 20 });
  private readonly frameEncoder = GIFEncoder({ auto: false, initialCapacity: 1 << 16 });
  private readonly shown: Uint8Array;
  private readonly shownIndex: Uint8Array;
  private readonly file: Palette;
  private pending: PendingFrame | null = null;
  private started = false;
  /** Frames actually written (after merging unchanged ones). */
  framesWritten = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly colors: Palette,
    private readonly tolerance = DIFF_TOLERANCE,
  ) {
    this.shown = new Uint8Array(width * height * 4);
    this.shownIndex = new Uint8Array(width * height);
    this.file = filePalette(colors);
  }

  /** Current encoded size, counting a not-yet-flushed frame as zero. */
  get byteLength(): number {
    return this.main.bytesView().length;
  }

  addFrame(rgba: ArrayLike<number>, delayCs: number): void {
    const { width, height } = this;
    if (!this.started) {
      this.started = true;
      const index = applyPalette(rgba as Uint8Array, this.colors, "rgb565");
      for (let i = 0; i < rgba.length; i++) this.shown[i] = rgba[i];
      this.shownIndex.set(index);
      this.pending = {
        bytes: null,
        index,
        rect: { x: 0, y: 0, width, height },
        delayCs,
        first: true,
      };
      return;
    }
    const rect = changedBounds(this.shown, rgba, width, height, this.tolerance);
    const index =
      rect &&
      diffIndices(this.shown, this.shownIndex, rgba, width, rect, this.colors, this.tolerance);
    if (!rect || !index) {
      if (this.pending) this.pending.delayCs += delayCs;
      return;
    }
    this.flush();
    this.pending = { bytes: null, index, rect, delayCs, first: false };
  }

  /** Flushes the last frame and the trailer; returns the complete file. */
  finish(): Uint8Array {
    this.flush();
    this.main.finish();
    return this.main.bytes();
  }

  private flush(): void {
    const frame = this.pending;
    if (!frame) return;
    this.pending = null;
    this.framesWritten++;
    // gifenc takes the delay in ms and rounds it to centiseconds.
    const delay = frame.delayCs * 10;
    if (frame.first) {
      this.main.writeFrame(frame.index, frame.rect.width, frame.rect.height, {
        palette: this.file,
        delay,
        repeat: 0, // NETSCAPE2.0 loop count 0 = forever
        dispose: DISPOSE_NONE,
      });
      return;
    }
    this.frameEncoder.reset();
    this.frameEncoder.writeFrame(frame.index, frame.rect.width, frame.rect.height, {
      first: false,
      delay,
      transparent: true,
      transparentIndex: TRANSPARENT_INDEX,
      dispose: DISPOSE_NONE,
    });
    const bytes = this.frameEncoder.bytes();
    patchImageOffset(bytes, frame.rect.x, frame.rect.y);
    this.main.stream.writeBytes(bytes);
  }
}

/**
 * Size estimate from a small sample (spec FR 6): one full frame plus the mean of the
 * sampled difference frames for every remaining frame, plus header and trailer.
 */
export function estimateGifBytes(
  firstFrameBytes: number,
  diffFrameBytes: number[],
  frameCount: number,
): number {
  if (frameCount <= 0) return 0;
  const meanDiff =
    diffFrameBytes.length > 0
      ? diffFrameBytes.reduce((sum, b) => sum + b, 0) / diffFrameBytes.length
      : firstFrameBytes;
  return Math.round(
    GIF_HEADER_BYTES + firstFrameBytes + meanDiff * (frameCount - 1) + GIF_TRAILER_BYTES,
  );
}

/**
 * Encoded sizes for an estimate sample: `full` = frame `a` as a first (full) frame, `diff`
 * = frame `b` written as a difference frame on top of `a` (0 when `b` adds nothing).
 */
export function measureFramePair(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  width: number,
  height: number,
  colors: Palette,
): { full: number; diff: number } {
  const alone = new GifStreamWriter(width, height, colors);
  alone.addFrame(a, 7);
  const aloneBytes = alone.finish().length;
  const pair = new GifStreamWriter(width, height, colors);
  pair.addFrame(a, 7);
  pair.addFrame(b, 7);
  const pairBytes = pair.finish().length;
  return { full: aloneBytes - GIF_HEADER_BYTES - GIF_TRAILER_BYTES, diff: pairBytes - aloneBytes };
}
