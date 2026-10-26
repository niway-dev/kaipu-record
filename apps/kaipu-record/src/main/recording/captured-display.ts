/**
 * Which display a capture source records — the space cursor samples are normalized to.
 * Pure: the caller passes desktopCapturer's `display_id` and `screen.getAllDisplays()`.
 *
 * Only SCREEN sources get a cursor track in v2. A `window:` source has no display
 * mapping: Electron cannot read another app's window bounds, and the window can move or
 * resize mid-recording, so there is nothing stable to normalize against.
 */
import type { RecordingArea } from "@shared/types/ipc";
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

/**
 * The space an AREA recording's cursor is normalized to (ADR 0030): the area itself, in
 * global DIP, so x/y of 0–1 span the recorded frame and the editor's zoom needs no offset.
 */
export function areaCapturedDisplay(
  display: CapturedDisplay,
  area: RecordingArea,
): CapturedDisplay {
  return {
    id: display.id,
    bounds: {
      x: display.bounds.x + area.rect.x,
      y: display.bounds.y + area.rect.y,
      width: area.rect.width,
      height: area.rect.height,
    },
    scaleFactor: display.scaleFactor,
    region: { displayId: display.id, x: area.rect.x, y: area.rect.y },
  };
}
