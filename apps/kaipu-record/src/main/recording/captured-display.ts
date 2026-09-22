/**
 * Which display a capture source records — the space cursor samples are normalized to.
 * Pure: the caller passes desktopCapturer's `display_id` and `screen.getAllDisplays()`.
 *
 * Only SCREEN sources get a cursor track in v2. A `window:` source has no display
 * mapping: Electron cannot read another app's window bounds, and the window can move or
 * resize mid-recording, so there is nothing stable to normalize against.
 */
import type { CapturedDisplay } from "./cursor-tracker";

export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export function pickCapturedDisplay(
  sourceId: string,
  /** desktopCapturer source `display_id` ("" or undefined on some platforms). */
  displayId: string | undefined,
  displays: DisplayLike[],
): CapturedDisplay | null {
  if (!sourceId.startsWith("screen:")) return null;
  const byId = displayId ? displays.find((d) => String(d.id) === displayId) : undefined;
  // Some platforms report an empty display_id; with a single display it is unambiguous.
  const display = byId ?? (displays.length === 1 ? displays[0] : undefined);
  if (!display || display.bounds.width <= 0 || display.bounds.height <= 0) return null;
  return {
    id: String(display.id),
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
  };
}
