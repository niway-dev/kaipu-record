import { backgroundPaint, frameRadius } from "../beautify/backgrounds";
import { roughArrow, roughRect } from "./rough";
import { smoothPath } from "./smooth";
import { BLUR_STD, HAND_FONT, STROKE_WIDTHS, TEXT_PX } from "./tools";
import type { Annotation, Scene } from "./scene";

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
  const href = await bytesToDataUrl(bytes);
  // Decode the PNG for its TRUE pixel size (Retina-safe — `getSize` can differ).
  const { width: naturalW, height: naturalH } = await imageSize(href);
  const scale = displayedW > 0 ? naturalW / displayedW : 1;
  const pad = Math.round(scene.beautify.padding * scale);
  const radius = Math.round(scene.beautify.radius * scale);
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const frameW = Math.round(c.w * naturalW) + pad * 2;
  const frameH = Math.round(c.h * naturalH) + pad * 2;
  const svg = buildSvg(scene, { href, naturalW, naturalH, pad, radius, frameW, frameH, scale });
  return rasterize(svg, frameW, frameH);
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
  frameW: number;
  frameH: number;
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
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const cropW = Math.round(c.w * g.naturalW);
  const cropH = Math.round(c.h * g.naturalH);
  const offX = Math.round(c.x * g.naturalW);
  const offY = Math.round(c.y * g.naturalH);
  const frameW = cropW + g.pad * 2; // computed here (ignores g.frameW), stays consistent
  const frameH = cropH + g.pad * 2;
  const baseX = g.pad - offX; // shift the shared image so the crop window sits at (pad,pad)
  const baseY = g.pad - offY;

  defs.push(
    `<clipPath id="rc"><rect x="${g.pad}" y="${g.pad}" width="${cropW}" height="${cropH}" rx="${g.radius}"/></clipPath>`,
  );
  // The base image, defined ONCE and referenced by <use> for the base + every blur box,
  // so a redacted export doesn't re-embed the (huge) data URL per blur (which blew up
  // the SVG and could fail rasterization with a few blurs).
  defs.push(
    `<image id="shot" href="${g.href}" width="${g.naturalW}" height="${g.naturalH}" preserveAspectRatio="none"/>`,
  );
  // Rounded-shot clip in the annotation group's local coords, so a blur near a rounded
  // corner can't spill past the frame.
  defs.push(
    `<clipPath id="rcLocal"><rect x="${offX}" y="${offY}" width="${cropW}" height="${cropH}" rx="${g.radius}"/></clipPath>`,
  );

  // Round the outer frame to match the live preview (BeautifiedFrame applies
  // frameRadius to the bg div) — a square rect here made exports differ.
  const outerR = Math.round(frameRadius(scene.beautify.bg, scene.beautify.radius) * g.scale);
  const bg =
    bgFill === "none"
      ? ""
      : `<rect width="${frameW}" height="${frameH}" rx="${outerR}" fill="${bgFill}"/>`;
  const shadow =
    sv > 0
      ? `<rect x="${g.pad}" y="${g.pad}" width="${cropW}" height="${cropH}" rx="${g.radius}" fill="#000" filter="url(#sh)"/>`
      : "";
  const image = `<use href="#shot" x="${baseX}" y="${baseY}" clip-path="url(#rc)"/>`;
  const anno = `<g transform="translate(${baseX},${baseY})" clip-path="url(#rcLocal)">${scene.annotations
    .map((a) => annotationSvg(a, g.naturalW, g.naturalH, g.scale))
    .join("")}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frameW}" height="${frameH}" viewBox="0 0 ${frameW} ${frameH}"><defs>${defs.join("")}</defs>${bg}${shadow}${image}${anno}</svg>`;
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
      `<path d="${roughArrow(x1, y1, x2, y2, a.seed)}" fill="none" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${roughArrow(x1, y1, x2, y2, a.seed + 19)}" fill="none" stroke="${a.color}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`
    );
  }
  if (a.kind === "path") {
    const sw = STROKE_WIDTHS[a.stroke] * scale;
    const d = smoothPath(a.points.map((pt) => ({ x: pt.x * W, y: pt.y * H })));
    return `<path d="${d}" fill="none" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const fs = TEXT_PX[a.size] * scale;
  return `<text x="${a.x * W}" y="${a.y * H}" fill="${a.color}" font-family="${HAND_FONT}" font-size="${fs}" font-weight="600" dominant-baseline="hanging">${escapeXml(a.text)}</text>`;
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

function rasterize(svg: string, w: number, h: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("compositor: no 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
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
