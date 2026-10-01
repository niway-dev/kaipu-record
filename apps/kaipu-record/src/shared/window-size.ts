import { ROUTES, type RouteName } from "./routes";

/**
 * The window each screen asks for.
 *
 * Three pairs, and they answer three different questions:
 *   - `width`/`height`      — the size the screen should be given when you reach it.
 *   - `minWidth`/`minHeight` — the size below which the screen stops working, not
 *     the size below which it looks tight. A grid that reflows to one column is
 *     fine; a timeline whose lanes become unreadable is not.
 *   - `maxWidth`/`maxHeight` — optional, and omitted almost everywhere on
 *     purpose. A maximum stops someone with a large display from using it, so a
 *     screen should only declare one when being wider genuinely breaks it.
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
 * One preset per screen. Written out rather than defaulted so each screen's
 * floor is a decision someone made, not an accident of what it inherited.
 *
 * The minimums are where each layout stops being usable:
 *  - the library's grid needs three cards and their labels to stay legible;
 *  - the editors need their preview, inspector and lanes at once;
 *  - the settings pages are a two-column form that collapses below ~900.
 */
export const WINDOW_PRESETS = {
  record: { width: 980, height: 720, minWidth: 820, minHeight: 640 },
  library: { width: 1180, height: 820, minWidth: 1040, minHeight: 700 },
  libraryDetail: { width: 1180, height: 820, minWidth: 1040, minHeight: 700 },
  screenshots: { width: 1080, height: 780, minWidth: 940, minHeight: 680 },
  screenshotEditor: { width: 1240, height: 820, minWidth: 1040, minHeight: 720 },
  videoEditor: { width: 1440, height: 900, minWidth: 1180, minHeight: 760 },
  shortcuts: { width: 980, height: 760, minWidth: 880, minHeight: 640 },
  cloud: { width: 1040, height: 760, minWidth: 900, minHeight: 640 },
  settings: { width: 1040, height: 780, minWidth: 900, minHeight: 660 },
  /** Auth is a single centred card; it never needs more than this. */
  signIn: { width: 900, height: 700, minWidth: 820, minHeight: 620 },
  signUp: { width: 900, height: 700, minWidth: 820, minHeight: 620 },
  /**
   * The first-run takeover does not reflow — a 96px mark, a headline, a two-line
   * subtitle and a 2x2 grid of permission cards.
   */
  onboarding: { width: 1000, height: 760, minWidth: 900, minHeight: 700 },
} as const satisfies Record<RouteName | "onboarding", WindowSizePreset>;

export type WindowPresetName = keyof typeof WINDOW_PRESETS;

/** Path → preset, derived from ROUTES so a renamed route cannot lose its size. */
const PRESET_BY_PATH = Object.fromEntries(
  (Object.keys(ROUTES) as RouteName[]).map((name) => [ROUTES[name], name]),
) as Record<string, WindowPresetName>;

/**
 * Which preset a path wants.
 *
 * Resolved from the path on every navigation rather than asked for by each page
 * on mount: the pages mount and unmount under a shell that does not, so a page
 * that grew the window had nothing to shrink it back on the way out.
 *
 * Nested paths fall back to their parent — `/settings/general` is a settings
 * screen — and anything unrecognised gets the record preset rather than nothing.
 */
export function presetForPath(pathname: string): WindowPresetName {
  const exact = PRESET_BY_PATH[pathname];
  if (exact) return exact;
  // `/library/<id>` and `/settings/<section>` are the parent screen resized.
  const parent = pathname.slice(0, pathname.indexOf("/", 1));
  if (parent === ROUTES.library) return "libraryDetail";
  if (parent === ROUTES.settings) return "settings";
  return "record";
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
): Required<Pick<WindowSizePreset, "width" | "height" | "minWidth" | "minHeight">> &
  Pick<WindowSizePreset, "maxWidth" | "maxHeight"> {
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
