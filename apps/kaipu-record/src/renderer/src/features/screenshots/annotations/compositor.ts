import { backgroundPaint, frameRadius } from "../beautify/backgrounds";
import { roughArrow, roughRect } from "./rough";
import { smoothPath } from "./smooth";
import {
  BLUR_STD,
  HAND_FONT,
  STROKE_WIDTHS,
  TEXT_LINE_HEIGHT,
  resolveFontPx,
  textLines,
} from "./tools";
import type { Annotation, Scene } from "./scene";

/**
 * Longest canvas side the compositor will rasterize to. Chromium caps a canvas
 * at 16384 px per side and a few hundred megapixels of area; a Retina capture at
 * 3× would blow past the area limit and `toBlob` would silently return null.
 * 8192 keeps a 2880-wide shot at 2× and smaller shots at 3×.
 */
export const MAX_RASTER_SIDE = 8192;

/**
 * The raster scale actually used for a `requested` multiplier on a frame of
 * `w`×`h` px: the largest integer ≤ `requested` that keeps both sides under
 * MAX_RASTER_SIDE, never below 1. Pure, exported for tests.
 */
export function clampRasterScale(requested: number, w: number, h: number): number {
  const wanted = Math.max(1, Math.floor(requested));
  const longest = Math.max(w, h, 1);
  const fits = Math.floor(MAX_RASTER_SIDE / longest);
  return Math.max(1, Math.min(wanted, fits));
}

export interface CompositeOptions {
  /**
   * Resolution multiplier over the frame's natural pixels. 1 (the default) is what
   * Copy/Save use — the PNG matches the shot 1:1. Exporters that embed a raster
   * into a zoomable container (PDF) ask for 2–3× so annotations stay crisp when
   * zoomed; clamped by `clampRasterScale`.
   */
  rasterScale?: number;
}

export interface CompositeResult {
  /** PNG bytes. */
  png: ArrayBuffer;
  /** The frame (crop window) in natural px — the PNG is `width*scale` × `height*scale`. */
  width: number;
  height: number;
  /** The raster scale actually applied after clamping. */
  scale: number;
}

/**
 * Composite the editor scene (beautify frame + annotations) to a PNG, at the
 * screenshot's natural resolution. Builds a self-contained SVG that mirrors the
 * live preview (same rough paths, same gradient/shadow) with the screenshot
 * embedded as a data URL, then rasterizes it on a canvas. Used by Copy + Save so
 * the output is exactly what the user sees.
 *
 * `displayedW` is the on-screen width of the shot; beautify px (padding/radius/
 * shadow/stroke) are display-relative, so they're scaled by naturalW/displayedW.
 */
export async function compositeScene(
  scene: Scene,
  bytes: ArrayBuffer,
  displayedW: number,
): Promise<ArrayBuffer> {
  return (await compositeSceneAt(scene, bytes, displayedW)).png;
}

/**
 * `compositeScene` with a resolution multiplier, returning the frame geometry
 * alongside the bytes. The SVG is vector (only the shot is a bitmap), so drawing
 * it onto a larger canvas keeps every annotation stroke and the frame edges sharp
 * at that scale — the shot itself is upsampled.
 */
export async function compositeSceneAt(
  scene: Scene,
  bytes: ArrayBuffer,
  displayedW: number,
  options: CompositeOptions = {},
): Promise<CompositeResult> {
  const href = await bytesToDataUrl(bytes);
  // Decode the PNG for its TRUE pixel size (Retina-safe — `getSize` can differ).
  const { width: naturalW, height: naturalH } = await imageSize(href);
  const scale = displayedW > 0 ? naturalW / displayedW : 1;
  const pad = Math.round(scene.beautify.padding * scale);
  const radius = Math.round(scene.beautify.radius * scale);
  // The crop is a window of the fully-composed frame (bg + padding + shot), normalized
  // 0–1 of that frame. The raster size is that window in native px; no crop = the whole frame.
  const fullW = naturalW + pad * 2;
  const fullH = naturalH + pad * 2;
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const outW = Math.round(c.w * fullW);
  const outH = Math.round(c.h * fullH);
  const svg = buildSvg(scene, { href, naturalW, naturalH, pad, radius, scale });
  const rasterScale = clampRasterScale(options.rasterScale ?? 1, outW, outH);
  const png = await rasterize(svg, outW, outH, rasterScale);
  return { png, width: outW, height: outH, scale: rasterScale };
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("compositor: image decode failed"));
    img.src = url;
  });
}

export interface Geom {
  href: string;
  naturalW: number;
  naturalH: number;
  pad: number;
  radius: number;
  scale: number;
}

/** Pure: builds the export SVG string from the scene + geometry. Exported for tests. */
export function buildSvg(scene: Scene, g: Geom): string {
  const paint = backgroundPaint(scene.beautify.bg);
  const sv = scene.beautify.shadow;
  const shY = Math.round(sv * 0.45 * g.scale);
  const shBlur = Math.round((sv * 0.9 + 8) * g.scale);
  const shAlpha = (0.12 + (sv / 100) * 0.5).toFixed(2);

  const defs: string[] = [];
  let bgFill = "none";
  if (paint.kind === "solid") {
    bgFill = paint.color;
  } else if (paint.kind === "gradient") {
    defs.push(
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${paint.from}"/><stop offset="1" stop-color="${paint.to}"/></linearGradient>`,
    );
    bgFill = "url(#bg)";
  }
  if (sv > 0) {
    defs.push(
      `<filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${shY}" stdDeviation="${shBlur / 2}" flood-color="#000" flood-opacity="${shAlpha}"/></filter>`,
    );
  }
  // The frame is composed ONCE at full size (bg + padding + shot). The crop is a viewBox
  // window over that frame — normalized 0–1 of the FRAME (not the base image), undefined =
  // whole frame. Padding is never re-added around the crop; the crop is a window of the
  // already-padded frame, so it can span into the background/padding.
  const fullW = g.naturalW + g.pad * 2;
  const fullH = g.naturalH + g.pad * 2;
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const vbX = Math.round(c.x * fullW);
  const vbY = Math.round(c.y * fullH);
  const outW = Math.round(c.w * fullW);
  const outH = Math.round(c.h * fullH);

  defs.push(
    `<clipPath id="rc"><rect x="${g.pad}" y="${g.pad}" width="${g.naturalW}" height="${g.naturalH}" rx="${g.radius}"/></clipPath>`,
  );
  // The base image, defined ONCE and referenced by <use> for the base + every blur box,
  // so a redacted export doesn't re-embed the (huge) data URL per blur (which blew up
  // the SVG and could fail rasterization with a few blurs).
  defs.push(
    `<image id="shot" href="${g.href}" width="${g.naturalW}" height="${g.naturalH}" preserveAspectRatio="none"/>`,
  );

  // Round the outer frame to match the live preview (BeautifiedFrame applies
  // frameRadius to the bg div) — a square rect here made exports differ.
  const outerR = Math.round(frameRadius(scene.beautify.bg, scene.beautify.radius) * g.scale);
  const bg =
    bgFill === "none"
      ? ""
      : `<rect width="${fullW}" height="${fullH}" rx="${outerR}" fill="${bgFill}"/>`;
  const shadow =
    sv > 0
      ? `<rect x="${g.pad}" y="${g.pad}" width="${g.naturalW}" height="${g.naturalH}" rx="${g.radius}" fill="#000" filter="url(#sh)"/>`
      : "";
  // Clip via a wrapping <g>, NOT on the translated <use>: a clip-path on an element that
  // also carries an x/y translation is resolved in the translated user space, so `rc`
  // (authored at (pad,pad)) would land at (2·pad,2·pad) and shear the shot's top-left off.
  // The group has no transform, so `rc` clips in root space where the shot actually is.
  const image = `<g clip-path="url(#rc)"><use href="#shot" x="${g.pad}" y="${g.pad}"/></g>`;
  // Annotations are NOT clipped to the shot rect: the live preview renders them
  // with overflow visible, so an arrow head / pen stroke / text that lands in the
  // beautify padding is shown there — clipping to the shot truncated it in the
  // export only. The output viewBox (the crop window, or the whole frame) is the
  // natural bound, so they render exactly as previewed.
  const anno = `<g transform="translate(${g.pad},${g.pad})">${scene.annotations
    .map((a) => annotationSvg(a, g.naturalW, g.naturalH, g.scale))
    .join("")}</g>`;

  // The output SVG selects the crop sub-rectangle via viewBox; width/height are the
  // window in native px, so it rasterizes 1:1 (no scaling).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${vbX} ${vbY} ${outW} ${outH}"><defs>${defs.join("")}</defs>${bg}${shadow}${image}${anno}</svg>`;
}

function annotationSvg(a: Annotation, W: number, H: number, scale: number): string {
  if (a.kind === "blur") {
    // Bake the redaction: a blurred, clipped copy of the shared #shot image over the
    // rect. The filter region is the rect + margin, so it only processes those pixels
    // (not the whole image) and samples neighbours so the blur doesn't fade at the edge.
    const std = BLUR_STD * scale;
    const bx = a.x * W;
    const by = a.y * H;
    const bw = a.w * W;
    const bh = a.h * H;
    const m = std * 3;
    return (
      `<defs><clipPath id="bclip-${a.id}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}"/></clipPath>` +
      `<filter id="bfilter-${a.id}" filterUnits="userSpaceOnUse" x="${bx - m}" y="${by - m}" width="${bw + 2 * m}" height="${bh + 2 * m}"><feGaussianBlur stdDeviation="${std}"/></filter></defs>` +
      `<use href="#shot" clip-path="url(#bclip-${a.id})" filter="url(#bfilter-${a.id})"/>`
    );
  }
  if (a.kind === "box") {
    const bw = a.w * W;
    const bh = a.h * H;
    const sw = STROKE_WIDTHS[a.stroke] * scale;
    const p1 = roughRect(bw, bh, 14 * scale, a.seed);
    const p2 = roughRect(bw, bh, 14 * scale, a.seed + 19);
    return (
      `<g transform="translate(${a.x * W},${a.y * H})">` +
      `<path d="${p1}" fill="${a.color}2e" stroke="none"/>` +
      `<path d="${p1}" fill="none" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${p2}" fill="none" stroke="${a.color}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>` +
      `</g>`
    );
  }
  if (a.kind === "arrow") {
    const x1 = a.x1 * W;
    const y1 = a.y1 * H;
    const x2 = a.x2 * W;
    const y2 = a.y2 * H;
    const sw = STROKE_WIDTHS[a.stroke] * scale;
    return (
      `<path d="${roughArrow(x1, y1, x2, y2, a.seed, scale)}" fill="none" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${roughArrow(x1, y1, x2, y2, a.seed + 19, scale)}" fill="none" stroke="${a.color}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`
    );
  }
  if (a.kind === "path") {
    const sw = STROKE_WIDTHS[a.stroke] * scale;
    const d = smoothPath(a.points.map((pt) => ({ x: pt.x * W, y: pt.y * H })));
    return `<path d="${d}" fill="none" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  // Through the resolver: a label sized by dragging a corner must export at the
  // size it was drawn at, not at the preset it started from.
  const fs = resolveFontPx(a.size, a.fontPx) * scale;
  const tx = a.x * W;
  // One tspan per line so manual breaks (Alt/Shift+Enter) AND width word-wrapping
  // survive the export exactly as they render in the preview. `fs` and the wrap width
  // both scale by `scale`, so the wrapped line count matches the preview.
  const widthPx = a.width ? a.width * W : undefined;
  const tspans = textLines(a.text, fs, widthPx)
    .map(
      (line, i) =>
        `<tspan x="${tx}" dy="${i === 0 ? 0 : fs * TEXT_LINE_HEIGHT}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text x="${tx}" y="${a.y * H}" fill="${a.color}" font-family="${HAND_FONT}" font-size="${fs}" font-weight="600" dominant-baseline="hanging">${tspans}</text>`;
}

function escapeXml(s: string): string {
  const map: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  };
  return s.replace(/[<>&'"]/g, (c) => map[c]);
}

function bytesToDataUrl(bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(new Blob([bytes], { type: "image/png" }));
  });
}

/**
 * Draw the SVG (authored at `w`×`h`) onto a canvas `k` times larger. `drawImage`
 * with an explicit destination size re-renders the vector content at the target
 * resolution rather than scaling a bitmap, which is what makes the high-DPI
 * raster worth embedding.
 */
function rasterize(svg: string, w: number, h: number, k: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * k;
      canvas.height = h * k;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("compositor: no 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0, w * k, h * k);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("compositor: toBlob failed"));
          return;
        }
        blob.arrayBuffer().then(resolve, reject);
      }, "image/png");
    };
    img.onerror = () => reject(new Error("compositor: SVG rasterize failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
