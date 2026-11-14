/**
 * The math behind dragging a floating image in the preview (NIW2-771): pure, so the layer only
 * turns pointer events into these calls. Everything is in PICTURE pixels (the preview's output
 * frame at the decoded size; only its aspect matters), converted from client pixels by the layer.
 */
import { MEDIA_MIN_BOX_WIDTH, mediaBoxPx, type PictureSize } from "./media";
import type { ImageMediaItem, MediaBox } from "./scene";

export type Corner = "nw" | "ne" | "sw" | "se";
export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

type Sized = Pick<ImageMediaItem, "box" | "naturalWidth" | "naturalHeight">;

/** Narrowest a box can be resized to, as a share of the picture (the model clamps to the same). */
export const MIN_RESIZE_WIDTH = MEDIA_MIN_BOX_WIDTH;

/** Move: the centre follows the pointer; the model clamps the centre inside the picture. */
export function dragBoxBody(
  start: MediaBox,
  deltaX: number,
  deltaY: number,
  picture: PictureSize,
): MediaBox {
  return {
    x: start.x + deltaX / picture.width,
    y: start.y + deltaY / picture.height,
    width: start.width,
  };
}

/**
 * Resize from a corner with the ASPECT LOCKED: the opposite corner stays where it is, the width
 * follows the pointer (whichever axis it moved further along), and the height derives from the
 * image's own aspect. The box never goes below `MIN_RESIZE_WIDTH` nor beyond the picture's width.
 */
export function dragBoxCorner(
  start: Sized,
  corner: Corner,
  deltaX: number,
  deltaY: number,
  picture: PictureSize,
): MediaBox {
  const rect = mediaBoxPx(start, picture);
  const aspect = start.naturalWidth / start.naturalHeight;
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  // The corner that stays put, and the dragged corner's start position.
  const anchorX = east ? rect.x : rect.x + rect.width;
  const anchorY = south ? rect.y : rect.y + rect.height;
  const cornerX = east ? rect.x + rect.width : rect.x;
  const cornerY = south ? rect.y + rect.height : rect.y;
  // How far the dragged corner is from the fixed one now, along each axis, outwards positive.
  const reachX = (east ? 1 : -1) * (cornerX + deltaX - anchorX);
  const reachY = (south ? 1 : -1) * (cornerY + deltaY - anchorY);
  const wanted = Math.max(reachX, reachY * aspect);
  const width = Math.max(MIN_RESIZE_WIDTH * picture.width, Math.min(picture.width, wanted));
  const height = width / aspect;
  const left = east ? anchorX : anchorX - width;
  const top = south ? anchorY : anchorY - height;
  return {
    x: (left + width / 2) / picture.width,
    y: (top + height / 2) / picture.height,
    width: width / picture.width,
  };
}
