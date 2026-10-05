import { ROUTES } from "./routes";

/**
 * The window a screen asks for.
 *
 *   - `width`/`height`      — a STARTING size, used when a window first needs one.
 *     Not a size to restore on every visit: see `presetForPath`.
 *   - `minWidth`/`minHeight` — where the layout stops working, not where it stops
 *     looking roomy. A grid that drops to two columns is fine; a timeline whose
 *     lanes become unreadable is not.
 *   - `maxWidth`/`maxHeight` — optional and unused. A maximum stops a large
 *     display from being used, so only a screen that genuinely breaks when wider
 *     should declare one. Content can have a max width without the window having
 *     one.
 *
 * Pure, so main and the renderer share one definition and the clamping below is
 * testable without a BrowserWindow.
 */
export interface WindowSizePreset {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Three presets, not one per screen.
 *
 * An earlier version gave every route its own size and applied it on every
 * navigation. Record → Library → Settings → Library resized the window four
 * times: the app took and released desktop space on its own, a window placed
 * beside another app lost that arrangement, and a window the user had
 * deliberately enlarged was reset — the app overriding a choice the user made.
 *
 * A screen having an ideal size does not mean it should impose it on arrival.
 * The main window keeps ONE size, which the user owns, and each screen lays its
 * content out inside whatever it is given. The video editor is the single
 * exception, because its layout genuinely needs the room, and leaving it
 * restores the size the window had before rather than a preset.
 */
export const WINDOW_PRESETS = {
  /**
   * Every screen but one: the sidebar pages AND the screenshot editor, whose
   * canvas and panel fit here without taking the window over.
   */
  main: { width: 1040, height: 760, minWidth: 900, minHeight: 670 },
  /**
   * The only exception. A preview, an inspector and five timeline lanes do not
   * fit the shared window, and below this the lanes stop being readable rather
   * than merely narrow.
   */
  videoEditor: { width: 1440, height: 900, minWidth: 1180, minHeight: 760 },
  /**
   * The first-run takeover does not reflow — a 96px mark, a headline, a two-line
   * subtitle and a 2x2 grid of permission cards.
   */
  onboarding: { width: 1000, height: 760, minWidth: 900, minHeight: 700 },
} as const satisfies Record<string, WindowSizePreset>;

export type WindowPresetName = keyof typeof WINDOW_PRESETS;

/**
 * Which preset a path wants.
 *
 * Only the video editor asks for something of its own; every other route is
 * `main`, and main treats a repeat as a no-op, so navigating anywhere else —
 * including into and out of the screenshot editor — never touches the window.
 *
 * Still resolved from the path rather than requested by each page on mount: the
 * pages mount and unmount under a shell that does not, so a page that grew the
 * window had nothing to shrink it back on the way out.
 */
export function presetForPath(pathname: string): WindowPresetName {
  return pathname === ROUTES.videoEditor ? "videoEditor" : "main";
}

/** True for the one screen that takes the window over. */
export function isEditorPreset(name: WindowPresetName): boolean {
  return name === "videoEditor";
}

/**
 * Fit a preset to a display.
 *
 * A laptop smaller than the request gets everything it has rather than a window
 * pushed past the edge of the screen, and the minimum is clamped too: a minimum
 * larger than the display leaves a window that cannot be moved or resized, which
 * is worse than a cramped layout.
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
    maxWidth: preset.maxWidth,
    maxHeight: preset.maxHeight,
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a window should go when it changes size: around its own centre, kept
 * inside the work area.
 *
 * Electron's `setSize` keeps the top-left corner fixed, so a window entering the
 * video editor grew only to the right and down — off-centre, and partly off a
 * screen it had been placed in the middle of. Growing around the centre keeps it
 * where the user left it; if that would cross an edge, it slides back inside
 * rather than shrinking, since the size is what the screen needs.
 */
export function boundsAroundCenter(
  current: Rect,
  size: { width: number; height: number },
  workArea: Rect,
): Rect {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const centreX = current.x + current.width / 2;
  const centreY = current.y + current.height / 2;
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(value, max));
  return {
    x: Math.round(clamp(centreX - width / 2, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(centreY - height / 2, workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}
