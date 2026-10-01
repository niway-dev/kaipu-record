import { describe, expect, it } from "vitest";
import { fitPresetToDisplay, presetForPath, WINDOW_PRESETS } from "./window-size";

const BIG = { width: 3840, height: 2160 };

describe("fitPresetToDisplay", () => {
  it("leaves a preset alone on a display that fits it", () => {
    expect(fitPresetToDisplay(WINDOW_PRESETS.videoEditor, BIG)).toEqual(WINDOW_PRESETS.videoEditor);
  });

  it("shrinks the requested size to the display", () => {
    const fitted = fitPresetToDisplay(WINDOW_PRESETS.videoEditor, { width: 1280, height: 800 });
    expect(fitted.width).toBe(1280);
    expect(fitted.height).toBe(800);
  });

  it("shrinks the MINIMUM too, so the window never outgrows the screen", () => {
    // A minimum wider than the display leaves a window that cannot be moved or
    // resized — strictly worse than a cramped layout.
    const fitted = fitPresetToDisplay(WINDOW_PRESETS.videoEditor, { width: 1024, height: 640 });
    expect(fitted.minWidth).toBeLessThanOrEqual(1024);
    expect(fitted.minHeight).toBeLessThanOrEqual(640);
  });

  it("never returns a minimum larger than the requested size", () => {
    // Otherwise the window silently grows past what the screen asked for.
    for (const preset of Object.values(WINDOW_PRESETS)) {
      for (const area of [BIG, { width: 1200, height: 700 }, { width: 800, height: 500 }]) {
        const fitted = fitPresetToDisplay(preset, area);
        expect(fitted.minWidth).toBeLessThanOrEqual(fitted.width);
        expect(fitted.minHeight).toBeLessThanOrEqual(fitted.height);
      }
    }
  });
});

describe("WINDOW_PRESETS", () => {
  it("never declares a minimum above its own requested size", () => {
    for (const [name, preset] of Object.entries(WINDOW_PRESETS)) {
      expect(preset.minWidth, name).toBeLessThanOrEqual(preset.width);
      expect(preset.minHeight, name).toBeLessThanOrEqual(preset.height);
    }
  });

  it("gives the editors more room than the base screens", () => {
    expect(WINDOW_PRESETS.videoEditor.width).toBeGreaterThan(WINDOW_PRESETS.base.width);
    expect(WINDOW_PRESETS.screenshotEditor.width).toBeGreaterThan(WINDOW_PRESETS.base.width);
  });
});

describe("presetForPath", () => {
  it("gives the editors their own presets", () => {
    expect(presetForPath("/video-editor")).toBe("videoEditor");
    expect(presetForPath("/screenshot-editor")).toBe("screenshotEditor");
  });

  it("gives every other route the base preset", () => {
    // Including the ones a user reaches straight after leaving an editor —
    // the shrink back used to depend on an unmount that never happened.
    for (const path of ["/", "/library", "/library/abc", "/screenshots", "/settings/app"]) {
      expect(presetForPath(path)).toBe("base");
    }
  });
});
