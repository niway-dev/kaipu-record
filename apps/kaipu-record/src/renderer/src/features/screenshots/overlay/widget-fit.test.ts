import { describe, expect, it } from "vitest";
import { widgetFitWidth } from "./widget-placement";
import { COMPACT_LEVEL, FIT_SLACK_DIP, fitLevel, widgetLook } from "./widget-fit";

// These cases pin the pure arithmetic (which level a width settles on) with stated widths, not
// measured ones. The widths are invented but shaped like the real row (the full row is about
// 1890 px, and each level gives up some of it). They were NOT measured in a real window: jsdom
// lays nothing out, so the real width per level still needs a look in the app.
const RECORD = [1890, 1770, 1660, 1580, 1490, 900];

/** The level the toolbar settles on once every level has been measured. */
const settled = (screenWidth: number, widths: readonly number[]): number =>
  fitLevel(widgetFitWidth({ x: 0, y: 0, width: screenWidth, height: 900 }), widths);

describe("fitLevel", () => {
  it("tries the full row first, then each narrower level, while nothing is measured to fit", () => {
    expect(fitLevel(1000, [])).toBe(0);
    expect(fitLevel(1000, [1890])).toBe(1);
    expect(fitLevel(1000, [1890, 1770])).toBe(2);
    expect(fitLevel(1000, [1890, 1770, 1660, 1580, 1490])).toBe(COMPACT_LEVEL);
  });

  it("keeps the first level that fits", () => {
    expect(fitLevel(2000, [1890])).toBe(0);
    expect(fitLevel(1800, [1890, 1770])).toBe(1);
  });

  it("needs the slack: a row exactly as wide as the room does not fit", () => {
    expect(fitLevel(1890, [1890, 1770])).toBe(1);
    expect(fitLevel(1890 + FIT_SLACK_DIP, [1890])).toBe(0);
  });

  it("keeps the compact look when even it is too wide", () => {
    expect(fitLevel(500, [1890, 1770, 1660, 1580, 1490, 900])).toBe(COMPACT_LEVEL);
  });

  describe("at the screen widths that matter (recording toolbar, 16 DIP margins)", () => {
    it("1920 drops only the Window chip", () => {
      expect(settled(1920, RECORD)).toBe(1);
      expect(widgetLook(1)).toMatchObject({ expanded: true, windowSoon: false, readout: true });
    });

    it("1512, a MacBook, falls back to compact for the recording row", () => {
      expect(settled(1512, RECORD)).toBe(COMPACT_LEVEL);
    });

    it("1512 keeps an expanded row when the shortened one fits", () => {
      expect(settled(1512, [1890, 1770, 1660, 1460, 1400, 900])).toBe(3);
    });

    it("1440 and 1280 end on a row that fits, never a wrapped one", () => {
      for (const width of [1440, 1280]) {
        const level = settled(width, RECORD);
        expect(level).toBe(COMPACT_LEVEL);
        expect(RECORD[level]! + FIT_SLACK_DIP).toBeLessThanOrEqual(
          widgetFitWidth({ x: 0, y: 0, width, height: 900 }),
        );
      }
    });
  });
});

describe("widgetLook", () => {
  it("gives up detail in order: Window chip, readout, long names, On/Off words, expanded", () => {
    expect(widgetLook(0)).toEqual({
      expanded: true,
      windowSoon: true,
      readout: true,
      shortNames: false,
      stateWords: true,
    });
    expect(widgetLook(1).windowSoon).toBe(false);
    expect(widgetLook(1).readout).toBe(true);
    expect(widgetLook(2).readout).toBe(false);
    expect(widgetLook(2).shortNames).toBe(false);
    expect(widgetLook(3).shortNames).toBe(true);
    expect(widgetLook(3).stateWords).toBe(true);
    expect(widgetLook(4).stateWords).toBe(false);
    expect(widgetLook(4).expanded).toBe(true);
    expect(widgetLook(COMPACT_LEVEL).expanded).toBe(false);
  });
});
