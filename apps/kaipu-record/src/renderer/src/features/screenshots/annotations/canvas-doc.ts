import { CANVAS_ASSET_ID_PATTERN } from "@shared/types/screenshot-canvas";
import {
  BACKGROUND_IDS,
  PADDING_RANGE,
  RADIUS_RANGE,
  SHADOW_RANGE,
  type BeautifyState,
} from "../beautify/backgrounds";
import type { Annotation, CropRect, Scene } from "./scene";
import { STEP_PX, STROKE_WIDTHS, TEXT_SIZES } from "./tools";

/** A stored preset index (stroke level, text size): an integer inside its table. Anything
 * else would draw a NaN stroke, so the document is refused instead. */
const level = (v: unknown, table: readonly unknown[]): boolean =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < table.length;

/**
 * The canvas document (ADR 0053), serialized as `.kaipu/<id>.canvas.json`. Main stores it
 * verbatim; this file owns the schema and its validation.
 *
 * Version 2 (NIW2-703) stores every geometry in WORLD units: 1 unit = 1 source px of the
 * base image, so an added image sitting left of or above the base has a plain negative
 * coordinate and nothing on disk depends on the base's size. The editor keeps working in
 * base-normalized units (the M2 model); the conversion happens only here, in
 * `buildCanvasDoc` and `parseCanvasDoc`. Version 1 (M3) was already base-normalized and
 * never held an added image, so it is read as it is.
 *
 * Version 3 (per-image crop) adds optional `crop` (visible window inside the asset,
 * 0–1 of the asset) and `radius` (source px) to an added image item. Both are unitless
 * or asset-relative, so the world conversion leaves them alone, and `x/y/w/h` stay the
 * visible rect. A build that only knows 1 and 2 rejects v3 on purpose: it would stretch
 * the whole asset into the cropped rect instead of showing the window.
 */
export const CANVAS_DOC_VERSION = 3;
/** Asset id of the base image. */
export const BASE_ASSET_ID = "base";

export interface CanvasImageItem {
  id: string;
  kind: "image";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pixelWidth: number;
  pixelHeight: number;
  /** v3: visible window inside the asset, normalized 0–1 of the asset. x/y/w/h stay the visible rect. */
  crop?: CropRect;
  /** v3: this image's own corner radius in source px; absent = the frame's global radius. */
  radius?: number;
}

/** The M3 document, read-only: base-normalized annotations, no added images. */
export interface CanvasDocV1 {
  schemaVersion: 1;
  /** z-order = array order. Item 0 is the base image; annotation coordinates are normalized to it (the M2 model), so an image item's x/y/w/h are in base-image px and the base sits at 0,0 with w/h = its pixel size. */
  items: (CanvasImageItem | Annotation)[];
  frame: BeautifyState;
  exportFrame?: CropRect;
}

export interface CanvasDocV2 {
  schemaVersion: 2 | 3;
  /**
   * z-order = array order. Item 0 is the base image (normally at 0,0 with w/h = its pixel
   * size); every x/y/w/h/points/width/exportFrame value below is in world units (base
   * source px), measured from the origin, not from the base's corner. Stroke, size,
   * fontPx, seed and color stay display-relative presets, as in the editor.
   */
  items: (CanvasImageItem | Annotation)[];
  frame: BeautifyState;
  exportFrame?: CropRect;
}

/** The base image's rect in world units: the unit all geometry is converted by. */
type WorldBase = { x: number; y: number; w: number; h: number };

/**
 * Applies one axis mapping to every geometry field of an annotation (and nothing else).
 * The maps take and return base-normalized values on the editor side. A measure is the one
 * kind the editor keeps in the base's SOURCE pixels (NIW2-702), so it is turned into
 * normalized values before a map to world (`toWorld`) and back into pixels after a map from
 * world.
 */
function mapGeometry(
  a: Annotation,
  px: (v: number) => number,
  py: (v: number) => number,
  sw: (v: number) => number,
  sh: (v: number) => number,
  toWorld: boolean,
): Annotation {
  switch (a.kind) {
    case "box":
    case "blur":
    case "image":
      return { ...a, x: px(a.x), y: py(a.y), w: sw(a.w), h: sh(a.h) };
    case "arrow":
      return { ...a, x1: px(a.x1), y1: py(a.y1), x2: px(a.x2), y2: py(a.y2) };
    case "text": {
      const t = { ...a, x: px(a.x), y: py(a.y) };
      if (a.width !== undefined) t.width = sw(a.width);
      return t;
    }
    case "path":
      return { ...a, points: a.points.map((p) => ({ x: px(p.x), y: py(p.y) })) };
    case "step":
      // The centre is a position; `size` is a display size level, like a stroke.
      return { ...a, x: px(a.x), y: py(a.y) };
    case "measure": {
      // Along the axis: `from`/`to`; across it: `at` (a row for axis x, a column for y).
      // `imageW`/`imageH` are the base's pixel size and stay as they are. A ruler spans whole
      // source pixels, so the way back rounds off the float noise of the round trip (else a
      // reopened label could read "36.99999999999999 px").
      const viaNorm = (map: (v: number) => number, size: number) => (v: number) =>
        toWorld ? map(v / size) : Math.round(map(v) * size);
      const x = viaNorm(px, a.imageW);
      const y = viaNorm(py, a.imageH);
      const [along, across] = a.axis === "x" ? [x, y] : [y, x];
      return { ...a, from: along(a.from), to: along(a.to), at: across(a.at) };
    }
  }
}

const rectMap = (
  r: CropRect,
  px: (v: number) => number,
  py: (v: number) => number,
  sw: (v: number) => number,
  sh: (v: number) => number,
): CropRect => ({
  x: px(r.x),
  y: py(r.y),
  w: sw(r.w),
  h: sh(r.h),
});

const toWorldMaps = (b: WorldBase) =>
  [
    (v: number) => b.x + v * b.w,
    (v: number) => b.y + v * b.h,
    (v: number) => v * b.w,
    (v: number) => v * b.h,
  ] as const;

const toNormMaps = (b: WorldBase) =>
  [
    (v: number) => (v - b.x) / b.w,
    (v: number) => (v - b.y) / b.h,
    (v: number) => v / b.w,
    (v: number) => v / b.h,
  ] as const;

/**
 * Builds the document for a save (always the current version, in world units). Every
 * redaction is written `locked`: this save bakes its pixels into every image it touches.
 * `crop` is not stored (canvas mode exports by `exportFrame`). An image annotation is
 * written as an image item at its z-position, after the base.
 *
 * `lockedAt(id)` (epoch ms) is asked for each redaction that is not yet locked in memory:
 * the caller decides the time (the page returns the first save that wrote it, so a later
 * autosave of the same session does not move it). One that is already locked keeps what it
 * has, even nothing: this save does not lock it. Without `lockedAt` no time is written.
 */
export function buildCanvasDoc(
  scene: Scene,
  base: { pixelWidth: number; pixelHeight: number; assetId?: string },
  opts: { lockedAt?: (annotationId: string) => number } = {},
): CanvasDocV2 {
  const image: CanvasImageItem = {
    id: "image-base",
    kind: "image",
    assetId: base.assetId ?? BASE_ASSET_ID,
    x: 0,
    y: 0,
    w: base.pixelWidth,
    h: base.pixelHeight,
    pixelWidth: base.pixelWidth,
    pixelHeight: base.pixelHeight,
  };
  const maps = toWorldMaps(image);
  const annotations = scene.annotations.map((a): Annotation => {
    const world = mapGeometry(a, ...maps, true);
    if (world.kind !== "blur") return world;
    const stamp =
      opts.lockedAt !== undefined && !world.locked ? { lockedAt: opts.lockedAt(world.id) } : {};
    return { ...world, ...stamp, locked: true };
  });
  const doc: CanvasDocV2 = {
    schemaVersion: CANVAS_DOC_VERSION,
    items: [image, ...annotations],
    frame: scene.beautify,
  };
  if (scene.exportFrame) doc.exportFrame = rectMap(scene.exportFrame, ...maps);
  return doc;
}

export interface ParsedCanvasDoc {
  /**
   * The base image (item 0), in world units as stored. Image items after it are not
   * here: they are `ImageAnnotation`s in `scene.annotations`, at their z-position.
   */
  base: CanvasImageItem;
  /** Base-normalized, whatever the stored version. `crop` is always undefined: canvas mode exports by `exportFrame`. */
  scene: Scene;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";
/** Smallest crop side, as a fraction of the asset. */
const MIN_CROP = 1e-3;
const nums = (o: Obj, keys: string[]): boolean => keys.every((k) => num(o[k]));

function parseImage(o: Obj): CanvasImageItem | null {
  if (!str(o.id) || !str(o.assetId) || !CANVAS_ASSET_ID_PATTERN.test(o.assetId)) return null;
  if (!nums(o, ["x", "y", "w", "h", "pixelWidth", "pixelHeight"])) return null;
  if ((o.w as number) <= 0 || (o.h as number) <= 0) return null;
  if ((o.pixelWidth as number) <= 0 || (o.pixelHeight as number) <= 0) return null;
  const item: CanvasImageItem = {
    id: o.id,
    kind: "image",
    assetId: o.assetId,
    x: o.x as number,
    y: o.y as number,
    w: o.w as number,
    h: o.h as number,
    pixelWidth: o.pixelWidth as number,
    pixelHeight: o.pixelHeight as number,
  };
  if (o.crop !== undefined) {
    const c = o.crop;
    // A window inside the asset: a crop outside 0–1 would read pixels that do not exist.
    if (!isObj(c) || !nums(c, ["x", "y", "w", "h"])) return null;
    const { x, y, w, h } = c as unknown as CropRect;
    // A sliver (1e-12) would make the whole asset 1e12 times the visible rect.
    if (w < MIN_CROP || h < MIN_CROP || x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9)
      return null;
    item.crop = { x, y, w, h };
  }
  if (o.radius !== undefined) {
    if (!num(o.radius) || o.radius < 0) return null;
    item.radius = o.radius;
  }
  return item;
}

function parseAnnotation(o: Obj): Annotation | null {
  if (!str(o.id)) return null;
  switch (o.kind) {
    case "box":
      return nums(o, ["x", "y", "w", "h", "stroke", "seed"]) &&
        level(o.stroke, STROKE_WIDTHS) &&
        str(o.color)
        ? (o as unknown as Annotation)
        : null;
    case "arrow":
      return nums(o, ["x1", "y1", "x2", "y2", "stroke", "seed"]) &&
        level(o.stroke, STROKE_WIDTHS) &&
        str(o.color)
        ? (o as unknown as Annotation)
        : null;
    case "text":
      if (!nums(o, ["x", "y", "size"]) || !str(o.text) || !str(o.color)) return null;
      if (!level(o.size, TEXT_SIZES)) return null;
      if (o.width !== undefined && !num(o.width)) return null;
      if (o.fontPx !== undefined && !num(o.fontPx)) return null;
      return o as unknown as Annotation;
    case "path":
      if (!nums(o, ["stroke"]) || !level(o.stroke, STROKE_WIDTHS)) return null;
      if (!str(o.color) || !Array.isArray(o.points)) return null;
      return o.points.every((p) => isObj(p) && nums(p, ["x", "y"]))
        ? (o as unknown as Annotation)
        : null;
    case "step":
      return nums(o, ["x", "y", "size"]) && level(o.size, STEP_PX) && str(o.color)
        ? (o as unknown as Annotation)
        : null;
    case "measure":
      return (o.axis === "x" || o.axis === "y") &&
        nums(o, ["from", "to", "at", "imageW", "imageH"]) &&
        (o.imageW as number) > 0 &&
        (o.imageH as number) > 0 &&
        str(o.color)
        ? (o as unknown as Annotation)
        : null;
    case "blur":
      if (!nums(o, ["x", "y", "w", "h"])) return null;
      if (o.style !== undefined && o.style !== "blur" && o.style !== "solid") return null;
      if (o.locked !== undefined && typeof o.locked !== "boolean") return null;
      if (o.lockedAt !== undefined && !num(o.lockedAt)) return null;
      return o as unknown as Annotation;
    default:
      return null;
  }
}

function parseFrame(v: unknown): BeautifyState | null {
  if (!isObj(v) || !str(v.bg) || !(BACKGROUND_IDS as readonly string[]).includes(v.bg)) return null;
  if (!nums(v, ["padding", "radius", "shadow"])) return null;
  // Inside the panel's ranges: a negative padding would give the export a negative size.
  const within = (n: unknown, r: { min: number; max: number }): boolean =>
    (n as number) >= r.min && (n as number) <= r.max;
  if (!within(v.padding, PADDING_RANGE) || !within(v.radius, RADIUS_RANGE)) return null;
  if (!within(v.shadow, SHADOW_RANGE)) return null;
  return v as unknown as BeautifyState;
}

/** Parses a stored document. Null means "fall back to the flattened PNG": never guess. */
export function parseCanvasDoc(json: string): ParsedCanvasDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || !Array.isArray(raw.items)) return null;
  // v1 is already base-normalized (identity); v2 is in world units. Anything else is a
  // version this build does not know how to read.
  const version = raw.schemaVersion;
  if (version !== 1 && version !== 2 && version !== 3) return null;
  const frame = parseFrame(raw.frame);
  if (!frame) return null;
  let exportFrame: CropRect | undefined;
  if (raw.exportFrame !== undefined) {
    if (!isObj(raw.exportFrame) || !nums(raw.exportFrame, ["x", "y", "w", "h"])) return null;
    exportFrame = raw.exportFrame as unknown as CropRect;
  }
  let base: CanvasImageItem | null = null;
  const annotations: Annotation[] = [];
  const items = raw.items;
  // Item 0 first: every other value of a v2 document is converted by the base's rect.
  const first: unknown = items[0];
  if (!isObj(first) || first.kind !== "image") return null; // item 0 must be the base image
  base = parseImage(first);
  // The base has no crop or radius yet: reading one as the base's world rect would be silently wrong.
  if (!base || base.crop || base.radius !== undefined) return null;
  const [px, py, sw, sh] = version !== 1 ? toNormMaps(base) : [null, null, null, null];
  const convert = (a: Annotation): Annotation => (px ? mapGeometry(a, px, py, sw, sh, false) : a);
  for (let i = 1; i < items.length; i++) {
    const item: unknown = items[i];
    if (!isObj(item)) return null;
    if (item.kind === "image") {
      const image = parseImage(item);
      if (!image) return null;
      // v1 never held added images: M3 ignored extras, so does this.
      if (version === 1) continue;
      if (image.assetId === BASE_ASSET_ID) return null; // reserved for the base
      annotations.push(
        convert({
          id: image.id,
          kind: "image",
          assetId: image.assetId,
          x: image.x,
          y: image.y,
          w: image.w,
          h: image.h,
          pixelWidth: image.pixelWidth,
          pixelHeight: image.pixelHeight,
          // Only a v3 document can hold them; a v2 file never wrote either.
          ...(version === 3 && image.crop ? { crop: image.crop } : {}),
          ...(version === 3 && image.radius !== undefined ? { radius: image.radius } : {}),
        }),
      );
      continue;
    }
    const annotation = parseAnnotation(item);
    if (!annotation) return null;
    annotations.push(convert(annotation));
  }
  const scene: Scene = { beautify: frame, annotations };
  if (exportFrame) scene.exportFrame = px ? rectMap(exportFrame, px, py, sw, sh) : exportFrame;
  return { base, scene };
}
