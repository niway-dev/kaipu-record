import type { NormRect } from "./redaction";

/**
 * Where a rect drawn on the FRAME lies on the picture an `object-fit: contain` element shows
 * inside it. The frame is the opened recording's box; a joined recording of another aspect is
 * scaled to fit and centred, leaving bars. The result is normalized to the picture, so it can
 * lie partly (or wholly) outside [0, 1] where the rect covers a bar: the caller samples only
 * the part inside.
 *
 * Same aspect (or an unknown one) is the identity, and returns the rect itself.
 */
export function frameRectToPictureRect(
  rect: NormRect,
  frameAspect: number,
  pictureAspect: number,
): NormRect {
  const usable = frameAspect > 0 && pictureAspect > 0;
  if (!usable || Math.abs(frameAspect - pictureAspect) <= 1e-6 * frameAspect) return rect;
  if (pictureAspect < frameAspect) {
    // Narrower picture: full height, bars left and right.
    const width = pictureAspect / frameAspect;
    const offset = (1 - width) / 2;
    return { x: (rect.x - offset) / width, y: rect.y, w: rect.w / width, h: rect.h };
  }
  // Wider picture: full width, bars above and below.
  const height = frameAspect / pictureAspect;
  const offset = (1 - height) / 2;
  return { x: rect.x, y: (rect.y - offset) / height, w: rect.w, h: rect.h / height };
}

/** True when `rect` lies wholly inside the picture (nothing of it is over a bar). */
export function isInsidePicture(rect: NormRect): boolean {
  const EPS = 1e-9;
  return (
    rect.x >= -EPS && rect.y >= -EPS && rect.x + rect.w <= 1 + EPS && rect.y + rect.h <= 1 + EPS
  );
}
