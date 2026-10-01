import { useEffect } from "react";

/**
 * Declare the minimum window size this screen needs, and give it back on the way
 * out.
 *
 * Most of the app reflows fine at the app's base floor. A few screens do not:
 * the video editor stacks a preview, an inspector and five timeline lanes, and
 * below a certain width the lanes stop being readable rather than simply
 * getting narrower. Those screens say so here instead of the floor being a
 * global setting that the smallest screen has to live with.
 *
 * Main clamps whatever is asked for to the display's work area, so a laptop
 * smaller than the request gets everything it has rather than a window pinned
 * to the whole desktop.
 *
 * The floor is released on unmount, so leaving the screen lets the window be
 * small again — a floor that outlived its screen would silently become the
 * app's floor until the next restart.
 */
export function useWindowFloor(minWidth: number, minHeight: number): void {
  useEffect(() => {
    window.electronAPI.setWindowFloor(minWidth, minHeight);
    return () => window.electronAPI.setWindowFloor(null, null);
  }, [minWidth, minHeight]);
}

/** Floors the app declares, in one place so two screens cannot disagree. */
export const WINDOW_FLOORS = {
  /** Preview + inspector + five timeline lanes. */
  videoEditor: { width: 1440, height: 900 },
  /** Canvas + tool rail + the beautify panel. */
  screenshotEditor: { width: 1040, height: 720 },
  /**
   * The first-run takeover does not reflow — a 96px mark, a headline, a two-line
   * subtitle and a 2x2 grid of permission cards. Width is the base floor; only
   * the height needs raising.
   */
  onboarding: { width: 0, height: 700 },
} as const;
