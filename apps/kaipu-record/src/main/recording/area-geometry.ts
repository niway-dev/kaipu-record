/**
 * Placement around a recording area (ADR 0030). Pure: the hub and the camera bubble pass
 * the numbers they read from Electron.
 */
import { MIN_AREA_SIZE } from "@shared/capture-geometry";
import type { RecordingArea, RecordingFinalizeMeta } from "@shared/types/ipc";
import { isRecordingRatio } from "@shared/types/screenshot-capture";
import {
  CAMERA_BUBBLE_AREA_MARGIN,
  CAMERA_BUBBLE_WINDOW_PAD,
  DEFAULT_CAMERA_BUBBLE,
  cameraBubbleWindowInArea,
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
export const BUBBLE_MARGIN = CAMERA_BUBBLE_AREA_MARGIN;

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
  // The same rule the overlay's placeholder uses (shared/camera-bubble.ts).
  return cameraBubbleWindowInArea(area, size, margin);
}

/** Where the user dragged the bubble: its window's bottom-left corner, in global DIP. */
export interface BubbleCorner {
  x: number;
  bottom: number;
}

/**
 * The bubble window's bounds for a window of `side` whose bottom-left corner the user put at
 * `corner`, moved back inside `container` (the recorded area, or the display's work area)
 * when the drag or a later resize would push it out. Keeping the bottom-left corner is what
 * makes the resize grip grow the bubble up and to the right wherever it was dropped.
 */
export function bubbleBoundsAt(container: Rect, side: number, corner: BubbleCorner): Rect {
  const clamp = (value: number, min: number, max: number): number =>
    Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
  return {
    x: clamp(corner.x, container.x, container.x + container.width - side),
    y: clamp(corner.bottom - side, container.y, container.y + container.height - side),
    width: side,
    height: side,
  };
}

/** The bubble's own side for window bounds from {@link bubbleBoundsInArea}. */
export function bubbleSizeOf(bounds: Rect): number {
  return bounds.width - 2 * BUBBLE_PAD;
}

/** Where the bubble sat in the recorded rectangle, and how big. */
export interface BubblePlacement {
  /** The bubble's centre, 0..1 from the rectangle's top-left corner. */
  position: { x: number; y: number };
  /** The bubble's side as a fraction of the rectangle's height. */
  sizeFraction: number;
}

/**
 * The bubble's placement in `recorded` (both global DIP), from its window's bounds: the pad
 * is symmetric, so the window's centre is the bubble's, and its side is the window's minus
 * the pad. 4 decimals. `null` when the centre lies outside the rectangle (the bubble was on
 * another display, so it is not in the video) or the rectangle is empty.
 */
export function bubblePlacementInRect(windowBounds: Rect, recorded: Rect): BubblePlacement | null {
  if (recorded.width <= 0 || recorded.height <= 0) return null;
  const x = (windowBounds.x + windowBounds.width / 2 - recorded.x) / recorded.width;
  const y = (windowBounds.y + windowBounds.height / 2 - recorded.y) / recorded.height;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  return {
    position: { x: round(x), y: round(y) },
    sizeFraction: round(Math.min(1, bubbleSizeOf(windowBounds) / recorded.height)),
  };
}

/**
 * The finalize meta with the bubble's placement set on its recorded layout, replacing
 * whatever the renderer sent: main is the only one that knows where the bubble sat. Without
 * a placement the fields are removed; without a recorded layout there is nothing to add them to.
 */
export function withRecordedBubble(
  meta: RecordingFinalizeMeta,
  placement: BubblePlacement | null,
): RecordingFinalizeMeta {
  const layout = meta.webcam?.recordedLayout;
  if (!meta.webcam || !layout) return meta;
  const { position: _position, sizeFraction: _sizeFraction, ...rest } = layout;
  return {
    ...meta,
    webcam: { ...meta.webcam, recordedLayout: placement ? { ...rest, ...placement } : rest },
  };
}

/**
 * Whether this OS can leave a content-protected window out of a screen capture. Windows builds
 * before 10 2004 (build 19041) have no `WDA_EXCLUDEFROMCAPTURE`: content protection there paints
 * the window black in captures instead of leaving it out. So there, a whole display's border
 * (inside the recorded pixels) is skipped, and the camera bubble stays in the capture with no
 * webcam file (the legacy path); an area's shade is outside the recorded crop and does not
 * matter. Every other platform and build: true.
 */
export function canExcludeWindowFromCapture(platform: string, osRelease: string): boolean {
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
