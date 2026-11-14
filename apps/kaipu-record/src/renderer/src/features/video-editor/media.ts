/**
 * Floating images over the Clips sequence (ADR 0057, spec 2026-11-13). Pure: no React, no DOM,
 * reachable from the export worker. `mediaAt` is the ONE function the preview and the export
 * draw floating items from, and `timeline.ts` stays the only place a timeline time maps to
 * the recording, so an item cannot be drawn at one time or place and exported at another.
 */
import type { ImageMediaItem, MediaBox, VideoScene } from "./scene";
import { anchorAt, layoutDuration, resolveAnchor, type LayoutEntry } from "./timeline";

export const MEDIA_DEFAULT_DURATION = 10;
/** Shortest a floating item can be dragged to. */
export const MEDIA_MIN_DURATION = 0.5;
export const MEDIA_DEFAULT_FADE_MS = 200;
export const MEDIA_MAX_FADE_MS = 2000;
/** The width of the Box preset, as a share of the picture. */
export const MEDIA_CORNER_WIDTH = 0.4;
/** Gap between the Box preset and the picture's edges, as a share of the picture width. */
const CORNER_MARGIN = 0.03;
/** Smallest a box can be resized to, as a share of the picture width. */
export const MEDIA_MIN_BOX_WIDTH = 0.05;

export interface PlacedMedia {
  item: ImageMediaItem;
  /** Timeline seconds. */
  start: number;
  end: number;
}

export interface VisibleMedia {
  item: ImageMediaItem;
  /** 0–1, over the fade ramps; items that would draw nothing are not returned. */
  opacity: number;
}

export interface PictureSize {
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The items that sit over the timeline right now, lowest `z` first. An item whose anchor no
 * longer resolves (its footage was deleted) is not placed, so it is gone from the timeline,
 * the preview and the export together, and comes back with the footage on undo. The end is
 * clamped to the end of the timeline: an item never extends the video.
 */
export function placeMedia(
  media: readonly ImageMediaItem[] | undefined,
  layout: LayoutEntry[],
): PlacedMedia[] {
  if (!media || media.length === 0) return [];
  const total = layoutDuration(layout);
  const placed: PlacedMedia[] = [];
  for (const item of media) {
    const start = resolveAnchor(layout, item.anchor);
    if (start === null) continue;
    const end = Math.min(start + item.duration, total);
    if (end <= start) continue;
    placed.push({ item, start, end });
  }
  return placed.sort((a, b) => a.item.z - b.item.z);
}

function overlaps(a: PlacedMedia, b: PlacedMedia): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The timeline row of each placed item: 1 is the row just above the sequence (row 0). Computed
 * from time overlap and `z`, never stored: `row = 1 + max(row of the lower-z items it overlaps
 * in time)`, or 1. Images that do not overlap share a row; two that do are on two rows with
 * the one in front above, whatever the array order.
 */
export function mediaRows(placed: readonly PlacedMedia[]): Map<string, number> {
  const ordered = [...placed].sort((a, b) => a.item.z - b.item.z);
  const rows = new Map<string, number>();
  for (const current of ordered) {
    let row = 1;
    for (const lower of ordered) {
      if (lower === current) break;
      if (overlaps(lower, current)) row = Math.max(row, (rows.get(lower.item.id) ?? 1) + 1);
    }
    rows.set(current.item.id, row);
  }
  return rows;
}

/** Opacity of a placed item at `t`: the fade ramps, scaled down together if they would cross. */
function opacityAt(placed: PlacedMedia, t: number): number {
  const length = placed.end - placed.start;
  let fadeIn = placed.item.fadeInMs / 1000;
  let fadeOut = placed.item.fadeOutMs / 1000;
  const ramps = fadeIn + fadeOut;
  if (ramps > length) {
    fadeIn = (fadeIn / ramps) * length;
    fadeOut = (fadeOut / ramps) * length;
  }
  const inRamp = fadeIn > 0 ? (t - placed.start) / fadeIn : 1;
  const outRamp = fadeOut > 0 ? (placed.end - t) / fadeOut : 1;
  return Math.max(0, Math.min(1, inRamp, outRamp));
}

/**
 * The floating items visible at timeline time `t`, back to front, each with its opacity. The
 * preview and the export both draw from this, so times, order and opacity cannot disagree.
 * An item is visible from its start up to, not including, its end.
 */
export function mediaAt(
  scene: Pick<VideoScene, "media">,
  layout: LayoutEntry[],
  t: number,
): VisibleMedia[] {
  const visible: VisibleMedia[] = [];
  for (const placed of placeMedia(scene.media, layout)) {
    if (t < placed.start || t >= placed.end) continue;
    const opacity = opacityAt(placed, t);
    if (opacity > 0) visible.push({ item: placed.item, opacity });
  }
  return visible;
}

/** The item's box in picture pixels: width from the box, height from the image's own aspect. */
export function mediaBoxPx(
  item: Pick<ImageMediaItem, "box" | "naturalWidth" | "naturalHeight">,
  picture: PictureSize,
): PixelRect {
  const width = item.box.width * picture.width;
  const height = (width * item.naturalHeight) / item.naturalWidth;
  return {
    x: item.box.x * picture.width - width / 2,
    y: item.box.y * picture.height - height / 2,
    width,
    height,
  };
}

/** Full: the largest box with the image's aspect inside the picture, centred. */
export function boxFitted(
  naturalWidth: number,
  naturalHeight: number,
  picture: PictureSize,
): MediaBox {
  const imageAspect = naturalWidth / naturalHeight;
  const pictureAspect = picture.width / picture.height;
  const width = imageAspect >= pictureAspect ? 1 : imageAspect / pictureAspect;
  return { x: 0.5, y: 0.5, width };
}

/** Box: 40 % of the picture width, at the bottom right, kept inside the picture. */
export function boxInCorner(
  naturalWidth: number,
  naturalHeight: number,
  picture: PictureSize,
): MediaBox {
  let width = MEDIA_CORNER_WIDTH;
  let heightShare = (width * picture.width * naturalHeight) / naturalWidth / picture.height;
  const marginY = (CORNER_MARGIN * picture.width) / picture.height;
  // A very tall image would leave the picture at 40 % of its width: shrink it to fit.
  const room = 1 - marginY * 2;
  if (heightShare > room) {
    width = (width * room) / heightShare;
    heightShare = room;
  }
  return { x: 1 - CORNER_MARGIN - width / 2, y: 1 - marginY - heightShare / 2, width };
}

function clampBox(box: MediaBox): MediaBox {
  return {
    x: Math.max(0, Math.min(1, box.x)),
    y: Math.max(0, Math.min(1, box.y)),
    width: Math.max(MEDIA_MIN_BOX_WIDTH, Math.min(1, box.width)),
  };
}

function clampFade(ms: number): number {
  return Math.max(0, Math.min(MEDIA_MAX_FADE_MS, Math.round(ms)));
}

function update(
  media: readonly ImageMediaItem[] | undefined,
  id: string,
  change: (item: ImageMediaItem) => ImageMediaItem,
): ImageMediaItem[] {
  return (media ?? []).map((item) => (item.id === id ? change(item) : item));
}

/**
 * Add an image at the playhead: 10 s (or to the end of the video), fitted to the whole picture,
 * in front of every other floating item, with the default fades. The sequence is untouched.
 * A playhead at the very end starts early enough to be visible for the minimum duration.
 */
export function addImageMedia(
  media: readonly ImageMediaItem[] | undefined,
  layout: LayoutEntry[],
  args: {
    id: string;
    assetId: string;
    naturalWidth: number;
    naturalHeight: number;
    playhead: number;
    picture: PictureSize;
  },
): ImageMediaItem[] {
  const total = layoutDuration(layout);
  const start = Math.max(0, Math.min(args.playhead, total - MEDIA_MIN_DURATION));
  const anchor = anchorAt(layout, start);
  if (!anchor) return [...(media ?? [])];
  const z = (media ?? []).reduce((top, item) => Math.max(top, item.z), -1) + 1;
  const item: ImageMediaItem = {
    id: args.id,
    kind: "image",
    assetId: args.assetId,
    naturalWidth: args.naturalWidth,
    naturalHeight: args.naturalHeight,
    anchor,
    duration: Math.max(MEDIA_MIN_DURATION, Math.min(MEDIA_DEFAULT_DURATION, total - start)),
    box: boxFitted(args.naturalWidth, args.naturalHeight, args.picture),
    z,
    fadeInMs: MEDIA_DEFAULT_FADE_MS,
    fadeOutMs: MEDIA_DEFAULT_FADE_MS,
  };
  return [...(media ?? []), item];
}

/** Move an item so it starts at timeline time `to`, keeping its duration and the timeline's ends. */
export function moveMedia(
  media: readonly ImageMediaItem[] | undefined,
  layout: LayoutEntry[],
  id: string,
  to: number,
): ImageMediaItem[] {
  const total = layoutDuration(layout);
  return update(media, id, (item) => {
    // An item the sequence was shortened under is cut at the end, and clamping against its stored
    // duration would throw a nudge to the start of the video: it may go as far right as there is
    // still room for the minimum duration, and it only has to fit whole when it fits now.
    const current = resolveAnchor(layout, item.anchor);
    const cut = current !== null && current + item.duration > total;
    const room = cut ? MEDIA_MIN_DURATION : item.duration;
    const start = Math.max(0, Math.min(to, Math.max(0, total - room)));
    const anchor = anchorAt(layout, start);
    return anchor ? { ...item, anchor } : item;
  });
}

/**
 * Drag one edge to timeline time `to`. The start edge rewrites the anchor and the duration
 * together, so the end stays put; the end edge changes only the duration. Neither goes below
 * the minimum duration, and the end edge stops at the end of the timeline.
 */
export function resizeMediaEdge(
  media: readonly ImageMediaItem[] | undefined,
  layout: LayoutEntry[],
  id: string,
  edge: "start" | "end",
  to: number,
): ImageMediaItem[] {
  const total = layoutDuration(layout);
  return update(media, id, (item) => {
    const start = resolveAnchor(layout, item.anchor);
    if (start === null) return item;
    const end = Math.min(start + item.duration, total);
    if (edge === "end") {
      const nextEnd = Math.max(start + MEDIA_MIN_DURATION, Math.min(to, total));
      return { ...item, duration: nextEnd - start };
    }
    const nextStart = Math.max(0, Math.min(to, end - MEDIA_MIN_DURATION));
    const anchor = anchorAt(layout, nextStart);
    return anchor ? { ...item, anchor, duration: end - nextStart } : item;
  });
}

export function setMediaBox(
  media: readonly ImageMediaItem[] | undefined,
  id: string,
  box: MediaBox,
): ImageMediaItem[] {
  return update(media, id, (item) => ({ ...item, box: clampBox(box) }));
}

export function setMediaFades(
  media: readonly ImageMediaItem[] | undefined,
  id: string,
  fades: { fadeInMs?: number; fadeOutMs?: number },
): ImageMediaItem[] {
  return update(media, id, (item) => ({
    ...item,
    fadeInMs: fades.fadeInMs === undefined ? item.fadeInMs : clampFade(fades.fadeInMs),
    fadeOutMs: fades.fadeOutMs === undefined ? item.fadeOutMs : clampFade(fades.fadeOutMs),
  }));
}

export function removeMedia(
  media: readonly ImageMediaItem[] | undefined,
  id: string,
): ImageMediaItem[] {
  return (media ?? []).filter((item) => item.id !== id);
}

/**
 * Bring forward / Send backward: the item moves just past the nearest item it overlaps in time
 * on that side, in the order of ALL items (placed or not), then `z` is rewritten as the
 * position. Moving it next to that item, rather than giving it that item's `z`, changes no other
 * pair's order, and an item hidden by deleted footage keeps its place for undo. The same array
 * comes back when there is nothing to pass.
 */
export function reorderMedia(
  media: readonly ImageMediaItem[] | undefined,
  layout: LayoutEntry[],
  id: string,
  direction: "forward" | "backward",
): ImageMediaItem[] {
  const source = (media ?? []) as ImageMediaItem[];
  const placedById = new Map(placeMedia(source, layout).map((p) => [p.item.id, p]));
  const current = placedById.get(id);
  if (!current) return source;
  const order = [...source].sort((a, b) => a.z - b.z);
  const index = order.findIndex((item) => item.id === id);
  const step = direction === "forward" ? 1 : -1;
  let target = index + step;
  while (target >= 0 && target < order.length) {
    const other = placedById.get(order[target].id);
    if (other && overlaps(current, other)) break;
    target += step;
  }
  if (target < 0 || target >= order.length) return source;
  const [moved] = order.splice(index, 1);
  // After the removal, `target` is the slot just past the neighbour in either direction.
  order.splice(target, 0, moved);
  const zById = new Map(order.map((item, position) => [item.id, position]));
  return source.map((item) => ({ ...item, z: zById.get(item.id)! }));
}
