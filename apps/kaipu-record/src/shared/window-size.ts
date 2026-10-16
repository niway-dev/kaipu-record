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
 * content out inside whatever it is given. The Editor workspace (`/editor` and
 * everything under it) is the single exception: the video editor's layout
 * genuinely needs the room, and the home, New image and the image editor share
 * its window so moving within the workspace never resizes it. Entering it from
 * a sidebar page grows the window; leaving it restores the size the window had
 * before rather than a preset. Owner decision, 2026-10-15.
 */
export const WINDOW_PRESETS = {
  /**
   * Every sidebar page. Content lays itself out inside whatever the user gives it.
   */
  main: { width: 1040, height: 760, minWidth: 900, minHeight: 670 },
  /**
   * The only exception: the whole Editor workspace (`/editor` and everything
   * under it). The video editor sets the size — a preview, an inspector and five
   * timeline lanes do not fit the shared window, and below this the lanes stop
   * being readable rather than merely narrow — and the image editor, the Editor
   * home and New image share it, so moving between the home and an open item
   * never resizes the window mid-session.
   */
  editor: { width: 1440, height: 900, minWidth: 1180, minHeight: 760 },
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
 * Only the Editor workspace asks for something of its own; every other route is
 * `main`, and main treats a repeat as a no-op, so navigating between sidebar
 * pages never touches the window. The legacy `/screenshot-editor` and
 * `/video-editor` paths stay on `main`: they redirect at once, and the path
 * they land on picks the preset.
 *
 * Still resolved from the path rather than requested by each page on mount: the
 * pages mount and unmount under a shell that does not, so a page that grew the
 * window had nothing to shrink it back on the way out.
 */
export function presetForPath(pathname: string): WindowPresetName {
  // `/editor` itself and everything under it: `/editor/video/:id`,
  // `/editor/image/:id`, `/editor/new`, `/editor/capture`. The slash is part of
  // the prefix so an unrelated `/editor-ish` route would not match.
  const isEditor = pathname === ROUTES.editor || pathname.startsWith(`${ROUTES.editor}/`);
  return isEditor ? "editor" : "main";
}

/** True for the one workspace that takes the window over. */
export function isEditorPreset(name: WindowPresetName): boolean {
  return name === "editor";
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
