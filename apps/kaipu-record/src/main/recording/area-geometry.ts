/**
 * Placement around a recording area (ADR 0030). Pure: the hub and the camera bubble pass
 * the numbers they read from Electron.
 */
import { MIN_AREA_SIZE } from "@shared/capture-geometry";
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

/** The slice of `Electron.Display` the validation reads. */
export interface AreaDisplay {
  id: number;
  bounds: Rect;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * An area that came from a renderer (overlay answer, settings patch, recording start), made
 * safe for `display`: it must name that display and be a finite rectangle; it is rounded to
 * whole DIP, clamped to the display, and refused when what is left is under the recording
 * minimum. `displaySize` is always the display's own, never the renderer's copy. Returns
 * `null` for anything else, so the shade, the bubble and the cursor never see a rectangle
 * off the display or a zero size.
 */
export function sanitizeArea(value: unknown, display: AreaDisplay): RecordingArea | null {
  if (!value || typeof value !== "object") return null;
  const { displayId, rect } = value as Record<string, unknown>;
  if (displayId !== display.id || !rect || typeof rect !== "object") return null;
  const { x, y, width, height } = rect as Record<string, unknown>;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  const { width: dw, height: dh } = display.bounds;
  const left = Math.max(0, Math.round(x as number));
  const top = Math.max(0, Math.round(y as number));
  const right = Math.min(dw, Math.round((x as number) + (width as number)));
  const bottom = Math.min(dh, Math.round((y as number) + (height as number)));
  if (right - left < MIN_AREA_SIZE || bottom - top < MIN_AREA_SIZE) return null;
  return {
    displayId: display.id,
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    displaySize: { width: dw, height: dh },
  };
}
