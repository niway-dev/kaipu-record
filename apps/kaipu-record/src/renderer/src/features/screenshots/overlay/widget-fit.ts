/**
 * How much of the expanded toolbar fits on one row (NIW2-883). Expanded is always one row and
 * never wraps Record or Cancel: when the work area is too narrow for the full row, the toolbar
 * gives up detail in a fixed order until the row fits, and falls back to the compact look as the
 * last resort.
 *
 *   0  the full expanded row
 *   1  without the disabled "Window · soon" chip
 *   2  without the size readout (and the display kind in Screen)
 *   3  long names shortened (Microphone -> Mic, System audio -> Audio, Copy to clipboard -> Copy)
 *   4  and without the On/Off words next to the switches
 *   5  the compact look
 *
 * The widths of the levels depend on fonts and translations, so they are measured, not guessed:
 * the widget renders at a level, reports its width, and `fitLevel` picks the next level to try
 * or the one to keep. This file is the pure half of that.
 */

/** The compact look: the last level, and what an unexpanded toolbar always shows. */
export const COMPACT_LEVEL = 5;

/** Room kept beside the measured row for what changes it a little (On and Off differ in width). */
export const FIT_SLACK_DIP = 12;

export interface WidgetLook {
  /** Labels, switches and the rest of the expanded row; false is the compact look. */
  expanded: boolean;
  /** The disabled "Window · soon" chip. */
  windowSoon: boolean;
  /** The size readout, and the display kind in Screen. */
  readout: boolean;
  /** Mic, Audio and Copy instead of Microphone, System audio and Copy to clipboard. */
  shortNames: boolean;
  /** The On / Off word beside each input's switch. */
  stateWords: boolean;
}

/** What the toolbar shows at `level` (0 is the full expanded row, `COMPACT_LEVEL` is compact). */
export function widgetLook(level: number): WidgetLook {
  return {
    expanded: level < COMPACT_LEVEL,
    windowSoon: level < 1,
    readout: level < 2,
    shortNames: level >= 3,
    stateWords: level < 4,
  };
}

/**
 * The level to render, given the width available to the row and the widths measured so far:
 * `measured[i]` is the row's width at level `i`, known for the levels already tried from 0 up.
 *
 * - the first measured level whose row fits (with `FIT_SLACK_DIP` to spare) is the answer;
 * - while every measured level is too wide, the next unmeasured level is the one to try;
 * - when even the compact look was measured and is too wide, it is kept: nothing is narrower.
 */
export function fitLevel(
  available: number,
  measured: readonly number[],
  slack: number = FIT_SLACK_DIP,
): number {
  for (let level = 0; level < COMPACT_LEVEL; level += 1) {
    const width = measured[level];
    if (width === undefined) return level;
    if (width + slack <= available) return level;
  }
  return COMPACT_LEVEL;
}
