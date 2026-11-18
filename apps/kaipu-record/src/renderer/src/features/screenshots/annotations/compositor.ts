import { backgroundPaint, frameRadius } from "../beautify/backgrounds";
import { roughArrow, roughRect } from "./rough";
import { smoothPath } from "./smooth";
import { MEASURE_FONT, measureLabel, measureShape, measureTextColor } from "./measure";
import {
  BLUR_STD,
  HAND_FONT,
  STEP_FONT,
  stepDiameterPx,
  STROKE_WIDTHS,
  TEXT_LINE_HEIGHT,
  resolveFontPx,
  stepFontPx,
  stepInk,
  STEP_HAIRLINE_ALPHA,
  STEP_HAIRLINE_PX,
  STEP_RING_COLOR,
  STEP_SHADOW_ALPHA,
  STEP_SHADOW_DY,
  STEP_SHADOW_STD,
  stepRingPx,
  textLines,
} from "./tools";
import {
  canvasLayout,
  contentExtents,
  intersectFrame,
  worldToFrame,
  type Extents,
} from "./canvas-geometry";
import { bakeCanvasRedactions, type CanvasAssets } from "./redaction";
import {
  stepNumbers,
  type Annotation,
  type BlurAnnotation,
  fullRect,
  type ImageAnnotation,
  type Scene,
} from "./scene";

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
  /**
   * Canvas mode (NIW2-698, behind `image-canvas`). false (default) = today's behavior.
   * true = the frame grows to the content box (image + every annotation's bounds, plus
   * padding), and `scene.exportFrame` (not `scene.crop`) selects the output window.
   */
  canvas?: boolean;
  /**
   * Canvas mode (NIW2-703): the PNG bytes of every added image, by asset id. An image
   * annotation whose asset is missing here makes the composite throw — the caller
   * reports it instead of exporting a frame with a hole in it.
   */
  assets?: CanvasAssets;
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
  options?: CompositeOptions,
): Promise<ArrayBuffer> {
  return (await compositeSceneAt(scene, bytes, displayedW, options)).png;
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
  // Canvas mode: redactions are destructive, so their pixels go into the base image and
  // into every added image they touch here (locked ones are already in them) and buildSvg
  // draws no blur. Untouched = same bytes.
  let base = bytes;
  let assetHrefs: Record<string, string> | undefined;
  if (options.canvas) {
    const assets = options.assets ?? {};
    for (const a of scene.annotations) {
      if (a.kind === "image" && !assets[a.assetId]) {
        throw new Error(`compositor: missing asset ${a.assetId}`);
      }
    }
    const baked = await bakeCanvasRedactions(bytes, assets, scene.annotations);
    base = baked.base;
    assetHrefs = {};
    for (const a of scene.annotations) {
      if (a.kind === "image" && !(a.assetId in assetHrefs)) {
        assetHrefs[a.assetId] = await bytesToDataUrl(baked.assets[a.assetId]);
      }
    }
  }
  const href = await bytesToDataUrl(base);
  // Decode the PNG for its TRUE pixel size (Retina-safe — `getSize` can differ).
  const { width: naturalW, height: naturalH } = await imageSize(href);
  const { scale, pad, radius, extents } = canvasExportGeometry(
    scene,
    naturalW,
    naturalH,
    displayedW,
  );
  // The crop is a window of the fully-composed frame (bg + padding + shot), normalized
  // 0–1 of that frame. The raster size is that window in native px; no crop = the whole frame.
  const geom: Geom = { href, naturalW, naturalH, pad, radius, scale };
  if (options.canvas) {
    geom.extents = extents;
    geom.assets = assetHrefs;
  }
  const { outW, outH } = frameWindow(scene, geom);
  const svg = buildSvg(scene, geom);
  const rasterScale = clampRasterScale(options.rasterScale ?? 1, outW, outH);
  const png = await rasterize(svg, outW, outH, rasterScale);
  return { png, width: outW, height: outH, scale: rasterScale };
}

/**
 * The numbers an export derives from the decoded image and the shot's on-screen width: the
 * display-to-source scale, the padding and corner radius in source px, and the content-box
 * extents (canvas mode). The one place they are computed: the composite and the editor's
 * export box both read it, so what the box says is what Copy and Save produce.
 */
export function canvasExportGeometry(
  scene: Scene,
  naturalW: number,
  naturalH: number,
  displayedW: number,
): { scale: number; pad: number; radius: number; extents: Extents } {
  const scale = displayedW > 0 ? naturalW / displayedW : 1;
  return {
    scale,
    pad: Math.round(scene.beautify.padding * scale),
    radius: Math.round(scene.beautify.radius * scale),
    extents: contentExtents(scene.annotations, naturalW, naturalH, scale),
  };
}

/**
 * The pixel size a canvas-mode export has at raster scale 1 (what Copy and Save produce):
 * the content box plus padding, or the export frame's window when one is set.
 *
 * `extents` replaces the ones measured from the scene's annotations: the editor passes the
 * live ones while a shape is being drawn or moved, before the scene holds it.
 */
export function exportPixelSize(
  scene: Scene,
  naturalW: number,
  naturalH: number,
  displayedW: number,
  extents?: Extents,
): { w: number; h: number } {
  const g = canvasExportGeometry(scene, naturalW, naturalH, displayedW);
  const { outW, outH } = frameWindow(scene, {
    href: "",
    naturalW,
    naturalH,
    ...g,
    ...(extents ? { extents } : {}),
  });
  return { w: outW, h: outH };
}

/**
 * A window of the composed frame, frame-normalized 0–1 (`c`), in whole px of a frame
 * `fullW` × `fullH`: origin and size rounded the way the export rounds them, so a size
 * shown while dragging a frame is the size the export gets.
 */
export function cropWindow(
  c: { x: number; y: number; w: number; h: number },
  fullW: number,
  fullH: number,
): { vbX: number; vbY: number; outW: number; outH: number } {
  const x1 = Math.round(c.x * fullW);
  const y1 = Math.round(c.y * fullH);
  return {
    vbX: x1,
    vbY: y1,
    outW: Math.max(1, Math.round((c.x + c.w) * fullW) - x1),
    outH: Math.max(1, Math.round((c.y + c.h) * fullH) - y1),
  };
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
  /**
   * Canvas mode: present = on. How far the content box sticks out past each side of the
   * image (natural px). All zero + no `exportFrame` yields the exact non-canvas SVG.
   */
  extents?: Extents;
  /** Canvas mode: data URL of each added image's (already redacted) PNG, by asset id. */
  assets?: Record<string, string>;
}

/**
 * The output window over the composed frame, in natural px: its origin (`vbX`, `vbY`)
 * and size. Non-canvas: `scene.crop` (frame-normalized) or the whole frame. Canvas:
 * `scene.exportFrame` (world-normalized, relative to the image) or the whole frame.
 */
export function frameWindow(
  scene: Scene,
  g: Geom,
): { vbX: number; vbY: number; outW: number; outH: number; fullW: number; fullH: number } {
  if (g.extents) {
    const l = canvasLayout({
      naturalW: g.naturalW,
      naturalH: g.naturalH,
      pad: g.pad,
      extents: g.extents,
    });
    const whole = { vbX: 0, vbY: 0, outW: l.fullW, outH: l.fullH, fullW: l.fullW, fullH: l.fullH };
    if (!scene.exportFrame) return whole;
    // The frame is in world units and can outlive a shrinking content box. The same rule
    // as the live preview (`intersectFrame`) clips it to the composed frame; nothing left
    // means no frame: the whole composed frame is exported.
    const c = intersectFrame(
      worldToFrame(scene.exportFrame, {
        naturalW: g.naturalW,
        naturalH: g.naturalH,
        pad: g.pad,
        extents: g.extents,
      }),
    );
    if (!c) return whole;
    return { ...cropWindow(c, l.fullW, l.fullH), fullW: l.fullW, fullH: l.fullH };
  }
  const fullW = g.naturalW + g.pad * 2;
  const fullH = g.naturalH + g.pad * 2;
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    vbX: Math.round(c.x * fullW),
    vbY: Math.round(c.y * fullH),
    outW: Math.round(c.w * fullW),
    outH: Math.round(c.h * fullH),
    fullW,
    fullH,
  };
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
  const { vbX, vbY, outW, outH, fullW, fullH } = frameWindow(scene, g);
  // Where the image's top-left sits in the frame: the padding, plus (canvas mode) how far
  // the content box sticks out left/top. Everything drawn in shot space is placed from here.
  const ext = g.extents;
  const ox = g.pad + (ext?.left ?? 0);
  const oy = g.pad + (ext?.top ?? 0);

  defs.push(
    `<clipPath id="rc"><rect x="${ox}" y="${oy}" width="${g.naturalW}" height="${g.naturalH}" rx="${g.radius}"/></clipPath>`,
  );
  // The base image, defined ONCE and referenced by <use> for the base + every blur box,
  // so a redacted export doesn't re-embed the (huge) data URL per blur (which blew up
  // the SVG and could fail rasterization with a few blurs).
  defs.push(
    `<image id="shot" href="${g.href}" width="${g.naturalW}" height="${g.naturalH}" preserveAspectRatio="none"/>`,
  );

  // Each added image (canvas mode), defined ONCE per asset and pixel size like #shot, however
  // many annotations place it at that size. <use> cannot resize an <image>, so a placement
  // resized apart from another one needs a def of its own size.
  const assetDefs = new Set<string>();
  for (const a of scene.annotations) {
    if (!ext || a.kind !== "image") continue;
    const id = assetDefId(a, g);
    if (assetDefs.has(id)) continue;
    const href = g.assets?.[a.assetId];
    if (href === undefined) throw new Error(`compositor: missing asset ${a.assetId}`);
    assetDefs.add(id);
    const full = fullRect(a);
    defs.push(
      `<image id="${id}" href="${href}" width="${full.w * g.naturalW}" height="${full.h * g.naturalH}" preserveAspectRatio="none"/>`,
    );
  }

  // Round the outer frame to match the live preview (BeautifiedFrame applies
  // frameRadius to the bg div) — a square rect here made exports differ.
  const outerR = Math.round(frameRadius(scene.beautify.bg, scene.beautify.radius) * g.scale);
  const bg =
    bgFill === "none"
      ? ""
      : `<rect width="${fullW}" height="${fullH}" rx="${outerR}" fill="${bgFill}"/>`;
  const shadow =
    sv > 0
      ? `<rect x="${ox}" y="${oy}" width="${g.naturalW}" height="${g.naturalH}" rx="${g.radius}" fill="#000" filter="url(#sh)"/>`
      : "";
  // Clip via a wrapping <g>, NOT on the translated <use>: a clip-path on an element that
  // also carries an x/y translation is resolved in the translated user space, so `rc`
  // (authored at (pad,pad)) would land at (2·pad,2·pad) and shear the shot's top-left off.
  // The group has no transform, so `rc` clips in root space where the shot actually is.
  const image = `<g clip-path="url(#rc)"><use href="#shot" x="${ox}" y="${oy}"/></g>`;
  // Annotations are NOT clipped to the shot rect: the live preview renders them
  // with overflow visible, so an arrow head / pen stroke / text that lands in the
  // beautify padding is shown there — clipping to the shot truncated it in the
  // export only. The output viewBox (the crop window, or the whole frame) is the
  // natural bound, so they render exactly as previewed.
  // Canvas mode (`ext` set): every blur was baked into each image it covers, so it draws
  // no filter. At its z-position it redraws the baked images BELOW it (the base, then the
  // added images earlier in the array) over its rect, so it covers an annotation drawn
  // before it and never paints over an image above it. Added images draw in z-order too.
  const steps = stepNumbers(scene.annotations);
  if (scene.annotations.some((a) => a.kind === "step")) defs.push(stepFilterSvg(g.scale));
  const anno = `<g transform="translate(${ox},${oy})">${scene.annotations
    .map((a, i) => {
      if (a.kind === "image") return imageSvg(a, g, sv > 0);
      if (a.kind === "blur" && ext) return bakedBlurSvg(a, scene.annotations.slice(0, i), g);
      const drawn = annotationSvg(a, g.naturalW, g.naturalH, g.scale, steps);
      if (!ext) return drawn;
      // Redrawing the baked images over a later redaction hides this annotation only where
      // those pixels are opaque. A base with transparency lets it show through, so the
      // annotation is cut out of every redaction drawn after it (NIW2-799).
      const covers = scene.annotations
        .slice(i + 1)
        .filter((b): b is BlurAnnotation => b.kind === "blur");
      if (covers.length === 0) return drawn;
      const maskId = `cut-${a.id}`;
      defs.push(redactionCutMask(maskId, covers, g));
      return `<g mask="url(#${maskId})">${drawn}</g>`;
    })
    .join("")}</g>`;

  // The output SVG selects the crop sub-rectangle via viewBox; width/height are the
  // window in native px, so it rasterizes 1:1 (no scaling).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="${vbX} ${vbY} ${outW} ${outH}"><defs>${defs.join("")}</defs>${bg}${shadow}${image}${anno}</svg>`;
}

/** The def id of an added image at its own size, so each distinct size is embedded once. */
function assetDefId(a: ImageAnnotation, g: Geom): string {
  // The def is the WHOLE asset at the size it has on the canvas (`fullRect`), so a crop
  // enters the id through that size: two placements share a def only when the asset is
  // drawn at the same size, whatever window each one shows.
  const f = fullRect(a);
  // A crop divides by a float, so equal sizes reached two ways differ by noise: round them to
  // 1/1000 px (only with a crop, so an uncropped id is what it always was).
  const size = (v: number) => (a.crop ? Math.round(v * 1000) / 1000 : v);
  return `asset-${a.assetId}-${size(f.w * g.naturalW)}x${size(f.h * g.naturalH)}`;
}

/**
 * One added image: its shadow (same filter as the base, when shadow > 0), then the shared
 * asset clipped to a rect with the beautify radius. Authored in the annotation group's
 * space (already translated to the base's corner). As with the base, the clip sits on a
 * wrapping <g> that carries no transform of its own: a clip-path on the <use> that also
 * carries the x/y translation would be resolved in the translated space and land twice.
 * Outside canvas mode there are no image annotations; one is drawn as nothing.
 */
function imageSvg(a: ImageAnnotation, g: Geom, shadow: boolean, idSuffix = ""): string {
  if (!g.extents) return "";
  const x = a.x * g.naturalW;
  const y = a.y * g.naturalH;
  const w = a.w * g.naturalW;
  const h = a.h * g.naturalH;
  const clip = `ic-${a.id}${idSuffix}`;
  // The clip is the VISIBLE rect; the asset is drawn whole from its own top-left, which
  // sits left of / above the visible rect when the image is cropped. Per-image radius
  // (source px) wins over the global one.
  const full = fullRect(a);
  const fx = full.x * g.naturalW;
  const fy = full.y * g.naturalH;
  const r = a.radius ?? g.radius;
  return (
    `<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath></defs>` +
    (shadow
      ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#000" filter="url(#sh)"/>`
      : "") +
    `<g clip-path="url(#${clip})"><use href="#${assetDefId(a, g)}" x="${fx}" y="${fy}"/></g>`
  );
}

/**
 * A mask that shows everything except the rects of `covers`. Authored in the annotation
 * group's space (translated to the base's corner), like the annotations it is applied to.
 */
function redactionCutMask(id: string, covers: readonly BlurAnnotation[], g: Geom): string {
  const far = 1_000_000;
  const holes = covers
    .map(
      (c) =>
        `<rect x="${c.x * g.naturalW}" y="${c.y * g.naturalH}" width="${c.w * g.naturalW}" height="${c.h * g.naturalH}" fill="#000"/>`,
    )
    .join("");
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${-far}" y="${-far}" width="${2 * far}" height="${2 * far}"><rect x="${-far}" y="${-far}" width="${2 * far}" height="${2 * far}" fill="#fff"/>${holes}</mask>`;
}

/**
 * A blur in canvas mode, at its z-position: the baked images below it, clipped to its rect.
 * Their pixels already hold the redaction, so no filter is drawn; redrawing them covers
 * any annotation stacked between those images and the blur.
 */
function bakedBlurSvg(a: BlurAnnotation, below: readonly Annotation[], g: Geom): string {
  const clip = `bclip-${a.id}`;
  const images = below
    .filter((b): b is ImageAnnotation => b.kind === "image")
    .map((b) => imageSvg(b, g, false, `-under-${a.id}`))
    .join("");
  return (
    `<defs><clipPath id="${clip}"><rect x="${a.x * g.naturalW}" y="${a.y * g.naturalH}" width="${a.w * g.naturalW}" height="${a.h * g.naturalH}"/></clipPath></defs>` +
    `<g clip-path="url(#${clip})"><use href="#shot"/>${images}</g>`
  );
}

/**
 * The badge hairline and drop shadow as ONE filter, referenced by every badge circle: a
 * dark ring `STEP_HAIRLINE_PX` outside the circle's white stroke, then a soft shadow, then the
 * badge itself. Region is relative to the badge box, wide enough for the shadow.
 */
function stepFilterSvg(scale: number): string {
  return (
    `<filter id="${STEP_FILTER_ID}" x="-100%" y="-100%" width="300%" height="300%">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="${STEP_HAIRLINE_PX * scale}" result="halo"/>` +
    `<feFlood flood-color="#000" flood-opacity="${STEP_HAIRLINE_ALPHA}"/>` +
    `<feComposite in2="halo" operator="in" result="hair"/>` +
    `<feGaussianBlur in="halo" stdDeviation="${STEP_SHADOW_STD * scale}" result="blur"/>` +
    `<feOffset in="blur" dx="0" dy="${STEP_SHADOW_DY * scale}" result="off"/>` +
    `<feFlood flood-color="#000" flood-opacity="${STEP_SHADOW_ALPHA}"/>` +
    `<feComposite in2="off" operator="in" result="shadow"/>` +
    `<feMerge><feMergeNode in="shadow"/><feMergeNode in="hair"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter>`
  );
}

const STEP_FILTER_ID = "stepf";

function annotationSvg(
  a: Annotation,
  W: number,
  H: number,
  scale: number,
  steps: Map<string, number>,
): string {
  if (a.kind === "step") {
    const d = stepDiameterPx(a.size);
    const n = steps.get(a.id) ?? 1;
    const ink = stepInk(a.color);
    const cx = a.x * W;
    const cy = a.y * H;
    return (
      `<circle cx="${cx}" cy="${cy}" r="${(d / 2) * scale}" fill="${a.color}" stroke="${STEP_RING_COLOR}" stroke-width="${stepRingPx(d) * scale}" filter="url(#${STEP_FILTER_ID})"/>` +
      `<text x="${cx}" y="${cy}" fill="${ink}" font-family="${STEP_FONT}" font-size="${stepFontPx(d, n) * scale}" font-weight="700" text-anchor="middle" dominant-baseline="central">${n}</text>`
    );
  }
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
  if (a.kind === "image") return ""; // drawn by imageSvg, which needs the geometry
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
  if (a.kind === "measure") {
    const s = measureShape(a, W, H, scale);
    const sw = STROKE_WIDTHS[1] * scale;
    const ticks = s.ticks
      .map(
        (t) =>
          `<line x1="${t[0]}" y1="${t[1]}" x2="${t[2]}" y2="${t[3]}" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round"/>`,
      )
      .join("");
    return (
      `<g data-kind="measure">` +
      `<line x1="${s.p1.x}" y1="${s.p1.y}" x2="${s.p2.x}" y2="${s.p2.y}" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round"/>` +
      ticks +
      `<rect x="${s.pill.x}" y="${s.pill.y}" width="${s.pill.w}" height="${s.pill.h}" rx="${s.pill.rx}" fill="${a.color}"/>` +
      `<text x="${s.text.x}" y="${s.text.y}" fill="${measureTextColor(a.color)}" font-family="${MEASURE_FONT}" font-size="${s.text.fontSize}" font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeXml(measureLabel(a))}</text>` +
      `</g>`
    );
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
