/**
 * The video editor's per-user view settings (ADR 0050): which timeline lanes are hidden.
 * Pure and import-free on purpose, like `audio-settings.ts`: main (the settings merge),
 * the preload bundle (through `types/ipc.ts`) and the renderer all read it, and this
 * directory must never take a value import from a workspace package.
 */

/** Every lane the timeline can draw, in lane order. `activity` is the marks inside Zooms. */
export const TRACK_KEYS = [
  "clips",
  "annotations",
  "zooms",
  "activity",
  "webcam",
  "privacy",
  "audio",
] as const;
export type TrackKey = (typeof TRACK_KEYS)[number];

/** Lanes that can never be hidden. */
export const ALWAYS_SHOWN: readonly TrackKey[] = ["clips"];

export interface EditorSettings {
  /**
   * Lanes the user turned off in the Tracks popover. View state only: the preview, the
   * export and the session never read it. Kept as stored, `activity` included.
   */
  hiddenTracks: TrackKey[];
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = { hiddenTracks: [] };

/**
 * A stored (possibly stale or hand-edited) list of hidden lanes. Drops `clips` and every
 * key this build does not know, and repeats. Keeps `activity` as stored: Zooms shown with
 * its marks off is a valid choice, and while Zooms is hidden the choice must survive.
 */
export function parseHiddenTracks(raw: unknown): TrackKey[] {
  if (!Array.isArray(raw)) return [];
  const hidden: TrackKey[] = [];
  for (const key of raw) {
    if (
      typeof key === "string" &&
      (TRACK_KEYS as readonly string[]).includes(key) &&
      !ALWAYS_SHOWN.includes(key as TrackKey) &&
      !hidden.includes(key as TrackKey)
    ) {
      hidden.push(key as TrackKey);
    }
  }
  return hidden;
}

export function sanitizeEditorSettings(value: unknown): EditorSettings {
  const safe = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { hiddenTracks: parseHiddenTracks(safe.hiddenTracks) };
}
