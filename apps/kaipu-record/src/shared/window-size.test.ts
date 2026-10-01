import { describe, expect, it } from "vitest";
import { ROUTES } from "./routes";
import { fitPresetToDisplay, isEditorPreset, presetForPath, WINDOW_PRESETS } from "./window-size";

const BIG = { width: 3840, height: 2160 };

describe("presetForPath", () => {
  it("gives every sidebar screen the SAME preset", () => {
    // This is the point: navigating between them must not resize the window.
    const sidebar = [
      ROUTES.record,
      ROUTES.library,
      "/library/abc-123",
      ROUTES.screenshots,
      ROUTES.shortcuts,
      ROUTES.cloud,
      ROUTES.settings,
      "/settings/general",
      // The screenshot editor shares the window too: only video takes it over.
      ROUTES.screenshotEditor,
    ];
    for (const path of sidebar) expect(presetForPath(path), path).toBe("main");
  });

  it("gives only the video editor its own", () => {
    expect(presetForPath(ROUTES.videoEditor)).toBe("videoEditor");
  });

  it("falls back to main for an unrecognised path", () => {
    expect(presetForPath("/nope")).toBe("main");
  });
});

describe("isEditorPreset", () => {
  it("is true only for the screens that take the window over", () => {
    expect(isEditorPreset("videoEditor")).toBe(true);
    expect(isEditorPreset("main")).toBe(false);
    expect(isEditorPreset("onboarding")).toBe(false);
  });
});

describe("WINDOW_PRESETS", () => {
  it("never declares a minimum above its own size", () => {
    for (const [name, preset] of Object.entries(WINDOW_PRESETS)) {
      expect(preset.minWidth, name).toBeLessThanOrEqual(preset.width);
      expect(preset.minHeight, name).toBeLessThanOrEqual(preset.height);
    }
  });

  it("declares no maximum anywhere", () => {
    // A maximum stops a large display from being used. The type carries one so a
    // screen that genuinely breaks when wider can say so; none does.
    for (const [name, preset] of Object.entries(WINDOW_PRESETS)) {
      expect("maxWidth" in preset, name).toBe(false);
    }
  });

  it("keeps the shared minimum at what the UI needs, not at the largest screen's", () => {
    // Taking the editor's floor for every screen would make the whole app
    // needlessly large; the main window stays at the smallest usable size.
    expect(WINDOW_PRESETS.main.minWidth).toBeLessThan(WINDOW_PRESETS.videoEditor.minWidth);
  });
});

describe("fitPresetToDisplay", () => {
  it("leaves a preset alone on a display that fits it", () => {
    expect(fitPresetToDisplay(WINDOW_PRESETS.videoEditor, BIG)).toMatchObject(
      WINDOW_PRESETS.videoEditor,
    );
  });

  it("shrinks the size AND the minimum to the display", () => {
    const fitted = fitPresetToDisplay(WINDOW_PRESETS.videoEditor, { width: 1024, height: 640 });
    expect(fitted.width).toBe(1024);
    expect(fitted.minWidth).toBeLessThanOrEqual(1024);
    expect(fitted.minHeight).toBeLessThanOrEqual(640);
  });

  it("never returns a minimum larger than the size", () => {
    for (const preset of Object.values(WINDOW_PRESETS)) {
      for (const area of [BIG, { width: 1200, height: 700 }, { width: 800, height: 500 }]) {
        const fitted = fitPresetToDisplay(preset, area);
        expect(fitted.minWidth).toBeLessThanOrEqual(fitted.width);
        expect(fitted.minHeight).toBeLessThanOrEqual(fitted.height);
      }
    }
  });
});
