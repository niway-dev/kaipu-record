/**
 * Which timeline lanes a recording can show and which of them the user hid (ADR 0050).
 * Pure. The keys and the parser live in `shared/editor-settings.ts` (the settings merge in
 * main needs them and `shared/` cannot take a value import from here); this file adds what
 * only the renderer needs. Hiding a lane is view state: the preview, the export plan and
 * the GIF plan never read any of this.
 */
import {
  ALWAYS_SHOWN,
  TRACK_KEYS,
  parseHiddenTracks,
  type TrackKey,
} from "@shared/editor-settings";
import type { SelectionKind } from "./editor-selection";

export { ALWAYS_SHOWN, TRACK_KEYS, parseHiddenTracks };
export type { TrackKey };

/**
 * The lanes a recording can show, in lane order. A new lane registers its key in
 * `TRACK_KEYS` and here (ADR 0050 decision 7): Activity needs a cursor track, Webcam needs a
 * camera.
 */
export function availableTracks(input: {
  hasCursorTrack: boolean;
  hasWebcam: boolean;
}): TrackKey[] {
  return TRACK_KEYS.filter((key) => {
    if (key === "activity") return input.hasCursorTrack;
    if (key === "webcam") return input.hasWebcam;
    return true;
  });
}

/**
 * Whether a lane is drawn off: its own key is stored, Clips never, the marks while Zooms is
 * hidden (they draw inside its lane). A key this build does not know is shown: the stored
 * list only holds keys the popover offered, and a lane with no row there could never be
 * turned back on.
 */
export function isTrackHidden(key: TrackKey, hidden: readonly TrackKey[]): boolean {
  if (ALWAYS_SHOWN.includes(key)) return false;
  if (key === "activity" && hidden.includes("zooms")) return true;
  return hidden.includes(key);
}

/**
 * The trigger's `n/m`: the rows the timeline draws, over the rows this recording has
 * (ADR 0050 decision 5). Goes through `isTrackHidden`, so Cursor activity is not counted
 * while Zooms is hidden even though its stored choice (and its checkbox) stays as it was.
 */
export function visibleCount(
  available: readonly TrackKey[],
  hidden: readonly TrackKey[],
): { shown: number; total: number } {
  const shown = available.filter((key) => !isTrackHidden(key, hidden)).length;
  return { shown, total: available.length };
}

/** The lane that draws an item of this selection kind; null when it is always shown. */
export function trackForSelection(kind: SelectionKind): TrackKey | null {
  switch (kind) {
    case "overlay":
      return "annotations";
    case "zoom":
      return "zooms";
    case "redaction":
      return "privacy";
    case "mute":
      return "audio";
    case "webcam":
      return "webcam";
    case "item":
      return null;
  }
}
