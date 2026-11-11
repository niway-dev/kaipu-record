/**
 * The decoded pixels behind Inspect mode (NIW2-699): pure helpers plus the two DOM decoders.
 * The decoders are the only place that touches a canvas, so tests mock them and the rest of
 * the feature stays DOM-free.
 */
import { p3ToSrgb, type Rgba } from "./color";

export interface PixelBuffer {
  width: number;
  height: number;
  /** RGBA, sRGB, row-major. */
  data: Uint8ClampedArray;
}

export function sampleAt(buf: PixelBuffer, x: number, y: number): Rgba | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return null;
  const i = (y * buf.width + x) * 4;
  return { r: buf.data[i], g: buf.data[i + 1], b: buf.data[i + 2], a: buf.data[i + 3] };
}

/** (2r+1)^2 RGBA pixels around (cx, cy); pixels outside the image stay fully transparent. */
export function loupePixels(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
): Uint8ClampedArray {
  const side = radius * 2 + 1;
  const out = new Uint8ClampedArray(side * side * 4);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const px = sampleAt(buf, cx - radius + col, cy - radius + row);
      if (!px) continue;
      const o = (row * side + col) * 4;
      out[o] = px.r;
      out[o + 1] = px.g;
      out[o + 2] = px.b;
      out[o + 3] = px.a;
    }
  }
  return out;
}

/**
 * The image pixel under a pointer. `rect` is the displayed image's bounding rect, which
 * already includes zoom and pan, so the same point of the picture maps to the same pixel at
 * any zoom. null when the pointer is outside the rect.
 */
export function clientToImagePixel(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  buf: { width: number; height: number },
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return { x: Math.floor(fx * buf.width), y: Math.floor(fy * buf.height) };
}

/**
 * Whether a point on `el` is actually visible: inside every ancestor that clips its content
 * (`overflow` other than `visible`). The classic editor shows a crop as a window over the
 * whole image, so the image's own rect also covers pixels the window hides.
 */
export function isPointVisible(el: Element, clientX: number, clientY: number): boolean {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const clips = [cs.overflow, cs.overflowX, cs.overflowY].some((v) => v && v !== "visible");
    if (!clips) continue;
    const r = node.getBoundingClientRect();
    if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) {
      return false;
    }
  }
  return true;
}

/** Release a canvas's backing store right away instead of waiting for the GC. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Decode PNG bytes into a standalone sRGB buffer. The M0 spike (ADR 0054) measured that an
 * explicit `srgb` canvas reads sRGB swatches back exactly, and that a `willReadFrequently`
 * canvas returns memory to baseline once released. The buffer costs about 81 MiB at 6K, so
 * the canvas and bitmap are dropped and only the copied array is kept.
 */
export async function decodeSrgbBuffer(bytes: ArrayBuffer): Promise<PixelBuffer> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  let canvas: HTMLCanvasElement | null = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "srgb" });
    return {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    };
  } finally {
    bitmap.close();
    if (canvas) releaseCanvas(canvas);
    canvas = null;
  }
}

/** A small tile read two ways, for the "as captured" and "out of sRGB" readouts. */
export interface ProbeTile {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /**
   * The display-profile values ("as captured"), read through a 2D canvas without colour
   * conversion. RGBA. Exact for opaque pixels; the canvas stores premultiplied alpha, so a fully
   * transparent pixel loses its RGB and partial alpha can round.
   */
  raw: Uint8ClampedArray;
  /** The same tile read as Display P3 bytes. RGBA. */
  p3: Uint8ClampedArray;
}

async function readTile(
  blob: Blob,
  rect: { sx: number; sy: number; sw: number; sh: number },
  options: ImageBitmapOptions,
  colorSpace: PredefinedColorSpace,
): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob, rect.sx, rect.sy, rect.sw, rect.sh, options);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { colorSpace, willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace });
    return new Uint8ClampedArray(image.data);
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

/**
 * Decode the `tile`-pixel square around (x, y), clamped to `bounds` when given. Once with
 * `colorSpaceConversion: "none"` (the raw bytes in the display's profile) and once with the
 * default conversion into a Display P3 canvas, whose bytes tell whether the colour fits sRGB.
 */
export async function probeCaptured(
  bytes: ArrayBuffer,
  x: number,
  y: number,
  tile = 32,
  bounds?: { width: number; height: number },
): Promise<ProbeTile> {
  const half = Math.floor(tile / 2);
  const sx = bounds
    ? Math.min(Math.max(0, x - half), Math.max(0, bounds.width - tile))
    : Math.max(0, x - half);
  const sy = bounds
    ? Math.min(Math.max(0, y - half), Math.max(0, bounds.height - tile))
    : Math.max(0, y - half);
  const sw = bounds ? Math.min(tile, bounds.width - sx) : tile;
  const sh = bounds ? Math.min(tile, bounds.height - sy) : tile;
  const rect = { sx, sy, sw, sh };
  const blob = new Blob([bytes], { type: "image/png" });
  const raw = await readTile(blob, rect, { colorSpaceConversion: "none" }, "srgb");
  const p3 = await readTile(blob, rect, {}, "display-p3");
  return { ...rect, raw, p3 };
}

/** What a probe knows about the image pixel (x, y); null when it is outside the tile. */
export function readProbe(
  probe: ProbeTile,
  x: number,
  y: number,
): { raw: Rgba; outOfGamut: boolean } | null {
  if (x < probe.sx || y < probe.sy || x >= probe.sx + probe.sw || y >= probe.sy + probe.sh) {
    return null;
  }
  const i = ((y - probe.sy) * probe.sw + (x - probe.sx)) * 4;
  const { raw, p3 } = probe;
  return {
    raw: { r: raw[i], g: raw[i + 1], b: raw[i + 2], a: raw[i + 3] },
    outOfGamut: p3ToSrgb([p3[i], p3[i + 1], p3[i + 2]]).outOfGamut,
  };
}
