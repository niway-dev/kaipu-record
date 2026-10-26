/**
 * Placement around a recording area (ADR 0030). Pure: the hub and the camera bubble pass
 * the numbers they read from Electron.
 */
import type { RecordingArea } from "@shared/types/ipc";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The camera bubble's window size and its distance from the area's edges, in DIP. */
export const BUBBLE_SIZE = 224;
export const BUBBLE_MARGIN = 40;

/** A display-relative area in global DIP, given its display's bounds. */
export function areaToGlobal(area: RecordingArea, displayBounds: Rect): Rect {
  return {
    x: displayBounds.x + area.rect.x,
    y: displayBounds.y + area.rect.y,
    width: area.rect.width,
    height: area.rect.height,
  };
}

/**
 * The bubble's bounds inside an area (global DIP): its bottom-left corner, with the same
 * margin the bubble keeps from a display's edge. `null` when the area cannot hold the
 * bubble and both margins on either side: the bubble is then not shown, because outside
 * the area it would silently be missing from the video.
 */
export function bubbleBoundsInArea(
  area: Rect,
  size = BUBBLE_SIZE,
  margin = BUBBLE_MARGIN,
): Rect | null {
  if (area.width < size + 2 * margin || area.height < size + 2 * margin) return null;
  return { x: area.x + margin, y: area.y + area.height - size - margin, width: size, height: size };
}
