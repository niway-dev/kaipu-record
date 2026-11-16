/**
 * Floating images on an exported frame (ADR 0057, spec 2026-11-13): what to draw and where,
 * as pure data. The composer draws exactly this list; the selection (which items, in what
 * order, with what opacity) is `mediaAt` itself and the rectangle is `mediaBoxPx`, the two
 * functions the preview draws from, so the export cannot show an item at another time, place
 * or stacking order than the preview.
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free (media.ts is too).
 */
import { mediaAt, mediaBoxPx, type PictureSize, type PixelRect } from "../media";
import type { ImageMediaItem } from "../scene";
import type { LayoutEntry } from "../timeline";

/**
 * The floating items of a plan, plain data (structured-cloneable) for the worker. `items` are
 * only the ones placed on the timeline, `layout` is the WHOLE timeline's layout (anchors
 * resolve against it) and `timeOffset` is the timeline time of the plan's time 0: 0 for an
 * MP4 export, the start of the range for a sliced (GIF) plan.
 */
export interface FloatingMediaPlan {
  items: ImageMediaItem[];
  layout: LayoutEntry[];
  timeOffset: number;
}

export interface FloatingDraw {
  item: ImageMediaItem;
  /** 0–1, the fade ramps already applied. */
  opacity: number;
  /** The item's box in picture pixels. */
  rect: PixelRect;
}

/**
 * The items to draw at output time `outTs` (the plan's own clock: the one the clip and slide
 * frames are stamped with), back to front, on a `picture`-sized canvas. Empty without items.
 */
export function floatingFrame(
  floating: FloatingMediaPlan | null | undefined,
  outTs: number,
  picture: PictureSize,
): FloatingDraw[] {
  if (!floating || floating.items.length === 0) return [];
  return mediaAt({ media: floating.items }, floating.layout, outTs + floating.timeOffset).map(
    ({ item, opacity }) => ({ item, opacity, rect: mediaBoxPx(item, picture) }),
  );
}

/** Whether any floating item draws something at output time `outTs` (see `floatingFrame`). */
export function floatingLiveAt(
  floating: FloatingMediaPlan | null | undefined,
  outTs: number,
): boolean {
  if (!floating || floating.items.length === 0) return false;
  return (
    mediaAt({ media: floating.items }, floating.layout, outTs + floating.timeOffset).length > 0
  );
}

/** The asset ids the export has to decode for floating items (none for no items). */
export function floatingAssetIds(floating: FloatingMediaPlan | null | undefined): Set<string> {
  return new Set((floating?.items ?? []).map((item) => item.assetId));
}
