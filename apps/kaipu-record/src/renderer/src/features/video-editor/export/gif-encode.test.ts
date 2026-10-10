import { describe, expect, it } from "vitest";
import { GifReader } from "omggif";
import {
  buildGlobalPalette,
  changedBounds,
  diffIndices,
  estimateGifBytes,
  GIF_HEADER_BYTES,
  GifStreamWriter,
  measureFramePair,
  TRANSPARENT_INDEX,
} from "./gif-encode";

const W = 32;
const H = 16;

/** Solid RGBA frame with an optional filled rect. */
function frame(
  bg: [number, number, number],
  rect?: { x: number; y: number; w: number; h: number; c: [number, number, number] },
): Uint8Array {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside =
        rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const c = inside ? rect.c : bg;
      const o = (y * W + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  return data;
}

/** Composite pixels of every frame, as a viewer shows them (disposal 1 = keep). */
function decodeAll(bytes: Uint8Array): { reader: GifReader; frames: Uint8Array[] } {
  const reader = new GifReader(bytes);
  const canvas = new Uint8Array(reader.width * reader.height * 4);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    reader.decodeAndBlitFrameRGBA(i, canvas);
    frames.push(canvas.slice());
  }
  return { reader, frames };
}

const px = (data: Uint8Array, x: number, y: number) =>
  Array.from(data.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

describe("changedBounds", () => {
  it("is null for identical frames and within tolerance", () => {
    const a = frame([10, 20, 30]);
    expect(changedBounds(a, a, W, H)).toBeNull();
    expect(changedBounds(a, frame([14, 16, 30]), W, H)).toBeNull();
  });

  it("is the bounding box of the changed pixels", () => {
    const a = frame([0, 0, 0]);
    const b = frame([0, 0, 0], { x: 5, y: 3, w: 4, h: 2, c: [255, 0, 0] });
    expect(changedBounds(a, b, W, H)).toEqual({ x: 5, y: 3, width: 4, height: 2 });
  });
});

describe("diffIndices", () => {
  it("marks unchanged pixels transparent and updates what is shown", () => {
    const shown = frame([0, 0, 0]);
    const next = frame([0, 0, 0], { x: 1, y: 1, w: 2, h: 1, c: [255, 255, 255] });
    const colors = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const shownIndex = new Uint8Array(W * H);
    const rect = { x: 0, y: 0, width: 4, height: 2 };
    const index = diffIndices(shown, shownIndex, next, W, rect, colors)!;
    expect(Array.from(index)).toEqual([255, 255, 255, 255, 255, 1, 1, 255]);
    expect(px(shown, 1, 1)).toEqual([255, 255, 255]);
    expect(shownIndex[1 * W + 1]).toBe(1);
    // Same frame again → nothing visible changes.
    expect(diffIndices(shown, shownIndex, next, W, rect, colors)).toBeNull();
  });
});

describe("GifStreamWriter", () => {
  const colors = buildGlobalPalette([frame([20, 40, 60]), frame([200, 30, 30])]);

  it("never maps a colour to the reserved transparent index", () => {
    expect(colors.length).toBeLessThanOrEqual(TRANSPARENT_INDEX);
  });

  it("writes a looping GIF with the expected size, frames and delays (golden)", () => {
    const writer = new GifStreamWriter(W, H, colors);
    const a = frame([20, 40, 60]);
    const b = frame([20, 40, 60], { x: 4, y: 4, w: 6, h: 6, c: [200, 30, 30] });
    // c = b plus a second rectangle elsewhere.
    const extra = frame([20, 40, 60], { x: 20, y: 2, w: 3, h: 3, c: [200, 30, 30] });
    const c = b.slice();
    for (let i = 0; i < c.length; i += 4) if (extra[i] === 200) c.set(extra.subarray(i, i + 4), i);
    writer.addFrame(a, 7);
    writer.addFrame(b, 7);
    writer.addFrame(c, 6);
    const bytes = writer.finish();
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    const { reader, frames } = decodeAll(bytes);
    expect(reader.width).toBe(W);
    expect(reader.height).toBe(H);
    expect(reader.loopCount()).toBe(0); // NETSCAPE2.0, loop forever
    expect(reader.numFrames()).toBe(3);
    expect([0, 1, 2].map((i) => reader.frameInfo(i).delay)).toEqual([7, 7, 6]);
    // Difference frames are cropped to the change and positioned at it.
    expect(reader.frameInfo(1)).toMatchObject({ x: 4, y: 4, width: 6, height: 6, disposal: 1 });
    expect(reader.frameInfo(2)).toMatchObject({ x: 20, y: 2, width: 3, height: 3 });
    // The composite of frame 2 shows both rectangles (b is kept underneath, disposal 1).
    expect(px(frames[2], 5, 5)).toEqual([200, 30, 30]);
    expect(px(frames[2], 21, 3)).toEqual([200, 30, 30]);
    expect(px(frames[2], 0, 0)).toEqual(px(a, 0, 0));
  });

  it("folds an unchanged frame into the previous frame's delay", () => {
    const writer = new GifStreamWriter(W, H, colors);
    const a = frame([20, 40, 60]);
    writer.addFrame(a, 7);
    writer.addFrame(a.slice(), 7);
    writer.addFrame(a.slice(), 6);
    const { reader } = decodeAll(writer.finish());
    expect(reader.numFrames()).toBe(1);
    expect(reader.frameInfo(0).delay).toBe(20);
  });

  it("keeps a burned-in cover on every frame while the content under it changes", () => {
    // The composer burns redactions in BEFORE encoding (compose-output-frame.ts). The
    // encoder must then never let earlier source pixels show through the region: the
    // cover stays opaque on every decoded frame even though the "source" under it moves.
    const cover = { x: 8, y: 4, w: 10, h: 8, c: [24, 24, 27] as [number, number, number] };
    const palette = buildGlobalPalette([frame([250, 250, 250], cover), frame([0, 200, 0], cover)]);
    const writer = new GifStreamWriter(W, H, palette);
    const sources: [number, number, number][] = [
      [250, 250, 250],
      [0, 200, 0],
      [250, 250, 250],
      [0, 200, 0],
    ];
    for (const bg of sources) writer.addFrame(frame(bg, cover), 7);
    const { frames } = decodeAll(writer.finish());
    expect(frames).toHaveLength(4);
    for (const composite of frames) {
      for (let y = cover.y; y < cover.y + cover.h; y++) {
        for (let x = cover.x; x < cover.x + cover.w; x++) {
          const [r, g, b] = px(composite, x, y);
          expect(Math.max(Math.abs(r - 24), Math.abs(g - 24), Math.abs(b - 27))).toBeLessThan(12);
        }
      }
    }
  });
});

describe("estimateGifBytes", () => {
  it("is header + first frame + mean diff × remaining frames + trailer", () => {
    expect(estimateGifBytes(1000, [100, 300], 11)).toBe(GIF_HEADER_BYTES + 1000 + 200 * 10 + 1);
  });

  it("falls back to full frames without diff samples and is 0 for no frames", () => {
    expect(estimateGifBytes(500, [], 3)).toBe(GIF_HEADER_BYTES + 1500 + 1);
    expect(estimateGifBytes(500, [10], 0)).toBe(0);
  });

  it("matches the real file size for a measured pair", () => {
    const colors = buildGlobalPalette([frame([20, 40, 60]), frame([200, 30, 30])]);
    const a = frame([20, 40, 60]);
    const b = frame([20, 40, 60], { x: 4, y: 4, w: 6, h: 6, c: [200, 30, 30] });
    const { full, diff } = measureFramePair(a, b, W, H, colors);
    const writer = new GifStreamWriter(W, H, colors);
    writer.addFrame(a, 7);
    writer.addFrame(b, 7);
    expect(estimateGifBytes(full, [diff], 2)).toBe(writer.finish().length);
  });
});
