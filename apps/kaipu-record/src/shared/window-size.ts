/**
 * The window size each screen asks for.
 *
 * Two numbers, not one: `width`/`height` is the size the screen wants to be
 * given, and `minWidth`/`minHeight` is the size below which it stops working.
 * The editor needs both — it should open large, and it must not be draggable
 * down to a width where the timeline lanes stop being readable.
 *
 * Pure so main and the renderer can share it and so the clamping below is
 * testable without a BrowserWindow.
 */
export interface WindowSizePreset {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** Every screen that asks for something other than the app's default. */
export const WINDOW_PRESETS = {
  /** The default: Record, Library, Settings, Shortcuts, Cloud. */
  base: { width: 900, height: 670, minWidth: 900, minHeight: 670 },
  /** Preview + inspector + five timeline lanes. */
  videoEditor: { width: 1440, height: 900, minWidth: 1180, minHeight: 760 },
  /** Canvas + tool rail + the beautify panel. */
  screenshotEditor: { width: 1240, height: 820, minWidth: 1040, minHeight: 720 },
  /**
   * The first-run takeover does not reflow — a 96px mark, a headline, a two-line
   * subtitle and a 2x2 grid of permission cards.
   */
  onboarding: { width: 1000, height: 760, minWidth: 900, minHeight: 700 },
} as const satisfies Record<string, WindowSizePreset>;

export type WindowPresetName = keyof typeof WINDOW_PRESETS;

/**
 * Fit a preset to a display.
 *
 * A laptop smaller than the request gets everything it has rather than a window
 * pinned past the edge of the screen, and the minimum is clamped too — a
 * minimum larger than the display would leave the window unmovable and
 * unshrinkable, which is worse than a cramped layout.
 *
 * The minimum is also never allowed above the requested size: that combination
 * silently grows the window past what the screen asked for.
 */
export function fitPresetToDisplay(
  preset: WindowSizePreset,
  workArea: { width: number; height: number },
): WindowSizePreset {
  const width = Math.min(preset.width, workArea.width);
  const height = Math.min(preset.height, workArea.height);
  return {
    width,
    height,
    minWidth: Math.min(preset.minWidth, width),
    minHeight: Math.min(preset.minHeight, height),
  };
}

/**
 * Which preset a route wants.
 *
 * A table rather than each page calling a hook: the page components mount and
 * unmount under a shell that does not, so a page asking on mount can grow the
 * window with nothing to shrink it back. Resolving from the path means every
 * navigation restates the answer, including the ones that leave an editor.
 */
const PRESET_BY_PATH: Record<string, WindowPresetName> = {
  "/video-editor": "videoEditor",
  "/screenshot-editor": "screenshotEditor",
};

export function presetForPath(pathname: string): WindowPresetName {
  return PRESET_BY_PATH[pathname] ?? "base";
}
