/**
 * Whether the capture selector's toolbar (the "capture widget") is expanded, remembered for
 * each capture type apart: a person who likes the labelled toolbar for recordings can keep
 * screenshots compact. Pure and import-free on purpose, like `editor-settings.ts`: main (the
 * settings merge), the preload bundle (through `types/ipc.ts`) and the renderer all read it,
 * and this directory must never take a value import from a workspace package.
 */

export interface CaptureWidgetSettings {
  /** The toolbar shows labels, switches and the size readout while the overlay takes a screenshot. */
  screenshotExpanded: boolean;
  /** The same while the overlay records. */
  recordingExpanded: boolean;
}

/** Both start compact: icons and key badges only. */
export const DEFAULT_CAPTURE_WIDGET_SETTINGS: CaptureWidgetSettings = {
  screenshotExpanded: false,
  recordingExpanded: false,
};

/** A stored (possibly stale or hand-edited) value; anything that is not a boolean is the default. */
export function sanitizeCaptureWidgetSettings(value: unknown): CaptureWidgetSettings {
  const safe = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    screenshotExpanded:
      typeof safe.screenshotExpanded === "boolean"
        ? safe.screenshotExpanded
        : DEFAULT_CAPTURE_WIDGET_SETTINGS.screenshotExpanded,
    recordingExpanded:
      typeof safe.recordingExpanded === "boolean"
        ? safe.recordingExpanded
        : DEFAULT_CAPTURE_WIDGET_SETTINGS.recordingExpanded,
  };
}
