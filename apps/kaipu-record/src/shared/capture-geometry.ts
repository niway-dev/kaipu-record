/**
 * Pure crop and DPI geometry for screenshot capture. No Electron imports: the
 * structural types below match the fields we read from `Electron.Display`.
 */

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
}

// Absorbs float noise (e.g. 0.1 * 3) so floor/ceil do not shift by one pixel.
const EPSILON = 1e-6;

/** Physical pixel size of a display: DIP size × scaleFactor, rounded. */
export function physicalSizeFor(display: DisplayLike): Size {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

/** The smallest recording area the overlay accepts, in DIP on each side. */
export const MIN_AREA_SIZE = 64;

/**
 * Crop rectangle in PHYSICAL pixels of `image` for a DIP rectangle given
 * relative to the display's bounds. The scale is derived from the image the
 * backend actually returned (image.size / display.bounds size), never from the
 * requested size or scaleFactor alone, so a smaller-than-requested answer still
 * crops the right region at lower resolution.
 */
export function cropForDisplay(
  imageSize: Size,
  display: DisplayLike,
  rectDip: Rectangle,
): Rectangle {
  return cropForSize(imageSize, display.bounds, rectDip);
}

/**
 * The same crop with only the display's DIP size: what a recording area needs, since
 * the renderer that encodes it knows the display's size but not its `Display`. The
 * origin is floored and the size ceiled, so every selected pixel is inside the crop.
 */
export function cropForSize(imageSize: Size, displaySize: Size, rectDip: Rectangle): Rectangle {
  const scaleX = imageSize.width / displaySize.width;
  const scaleY = imageSize.height / displaySize.height;

  const x = clamp(Math.floor(rectDip.x * scaleX + EPSILON), 0, Math.max(imageSize.width - 1, 0));
  const y = clamp(Math.floor(rectDip.y * scaleY + EPSILON), 0, Math.max(imageSize.height - 1, 0));
  const width = clamp(
    Math.ceil(rectDip.width * scaleX - EPSILON),
    1,
    Math.max(imageSize.width - x, 1),
  );
  const height = clamp(
    Math.ceil(rectDip.height * scaleY - EPSILON),
    1,
    Math.max(imageSize.height - y, 1),
  );
  return { x, y, width, height };
}

/**
 * Clamp a DIP frame (display-relative) to the display's work area, keeping its
 * size when it fits and shrinking it when it does not; a remembered frame that
 * no longer fits is re-clamped, not dropped. Minimum size: 1×1.
 */
export function clampFrameToDisplay(frame: Rectangle, display: DisplayLike): Rectangle {
  const area = toDisplayRelative(display.workArea, display);
  const width = clamp(Math.round(frame.width), 1, Math.max(area.width, 1));
  const height = clamp(Math.round(frame.height), 1, Math.max(area.height, 1));
  return {
    x: clamp(Math.round(frame.x), area.x, area.x + area.width - width),
    y: clamp(Math.round(frame.y), area.y, area.y + area.height - height),
    width,
    height,
  };
}

/** Convert a global DIP rectangle to display-relative. */
export function toDisplayRelative(rect: Rectangle, display: DisplayLike): Rectangle {
  return { ...rect, x: rect.x - display.bounds.x, y: rect.y - display.bounds.y };
}

/** Convert a display-relative DIP rectangle to global. */
export function toGlobal(rect: Rectangle, display: DisplayLike): Rectangle {
  return { ...rect, x: rect.x + display.bounds.x, y: rect.y + display.bounds.y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}
