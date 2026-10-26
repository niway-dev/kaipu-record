/**
 * Placement around a recording area (ADR 0030). Pure: the hub and the camera bubble pass
 * the numbers they read from Electron.
 */
import { MIN_AREA_SIZE } from "@shared/capture-geometry";
import type { RecordingArea } from "@shared/types/ipc";
import { isRecordingRatio } from "@shared/types/screenshot-capture";
import {
  CAMERA_BUBBLE_MIN_SIZE,
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  clampCameraBubbleSize,
} from "@shared/camera-bubble";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room the bubble's window keeps around the bubble (see `shared/camera-bubble.ts`). */
export const BUBBLE_PAD = CAMERA_BUBBLE_WINDOW_PAD;
/** The window's distance from the area's (or display's) left and bottom edges, in DIP. */
export const BUBBLE_MARGIN = 32;

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
 * The bubble window's bounds inside an area (global DIP), for a bubble of `size`: anchored
 * at the area's bottom-left corner, growing up and to the right. A size the area cannot
 * hold (with the margins on both sides) is clamped down to what fits; `null` when not even
 * the minimum size fits. The bubble is then not shown, because outside the area it would
 * silently be missing from the video.
 */
export function bubbleBoundsInArea(
  area: Rect,
  size: number = DEFAULT_CAMERA_BUBBLE.size,
  margin = BUBBLE_MARGIN,
): Rect | null {
  const room = Math.min(area.width, area.height) - 2 * margin - 2 * BUBBLE_PAD;
  const fitted = Math.min(clampCameraBubbleSize(size), Math.floor(room));
  if (fitted < CAMERA_BUBBLE_MIN_SIZE) return null;
  const side = fitted + 2 * BUBBLE_PAD;
  return { x: area.x + margin, y: area.y + area.height - margin - side, width: side, height: side };
}

/** The bubble's own side for window bounds from {@link bubbleBoundsInArea}. */
export function bubbleSizeOf(bounds: Rect): number {
  return bounds.width - 2 * BUBBLE_PAD;
}

/**
 * Windows builds before 10 2004 (build 19041) have no `WDA_EXCLUDEFROMCAPTURE`: content
 * protection there paints the window black in captures instead of leaving it out. An area's
 * shade is outside the recorded crop, so it does not matter; a whole display's border is
 * inside the recorded pixels, so it is skipped there. Every other platform and build: allowed.
 */
export function fullDisplayBorderAllowed(platform: string, osRelease: string): boolean {
  if (platform !== "win32") return true;
  const [major, , build] = osRelease.split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(build)) return true;
  return major! > 10 || (major === 10 && build! >= 19041);
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
  const { displayId, rect, ratio } = value as Record<string, unknown>;
  if (displayId !== display.id || !rect || typeof rect !== "object") return null;
  const { x, y, width, height } = rect as Record<string, unknown>;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  const { width: dw, height: dh } = display.bounds;
  const left = Math.max(0, Math.round(x as number));
  const top = Math.max(0, Math.round(y as number));
  const right = Math.min(dw, Math.round((x as number) + (width as number)));
  const bottom = Math.min(dh, Math.round((y as number) + (height as number)));
  if (right - left < MIN_AREA_SIZE || bottom - top < MIN_AREA_SIZE) return null;
  const area: RecordingArea = {
    displayId: display.id,
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    displaySize: { width: dw, height: dh },
  };
  // The ratio the Frame box was locked to (#383) travels with the area so the take's capture
  // metadata stores it instead of inferring it; anything that is not a chip is dropped.
  if (isRecordingRatio(ratio)) area.ratio = ratio;
  return area;
}
