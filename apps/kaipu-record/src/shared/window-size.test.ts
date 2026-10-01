import { describe, expect, it } from "vitest";
import { ROUTES, type RouteName } from "./routes";
import { fitPresetToDisplay, presetForPath, WINDOW_PRESETS } from "./window-size";

const BIG = { width: 3840, height: 2160 };

describe("WINDOW_PRESETS", () => {
  it("covers every route, so no screen falls back by accident", () => {
    for (const name of Object.keys(ROUTES) as RouteName[]) {
      expect(WINDOW_PRESETS[name], name).toBeDefined();
    }
  });

  it("never declares a minimum above its own size", () => {
    for (const [name, preset] of Object.entries(WINDOW_PRESETS)) {
      expect(preset.minWidth, name).toBeLessThanOrEqual(preset.width);
      expect(preset.minHeight, name).toBeLessThanOrEqual(preset.height);
    }
  });

  it("declares no maximum anywhere", () => {
    // A maximum stops a large display from being used. The type carries one so a
    // screen that genuinely breaks when wider can say so; none does today, and
    // this guards against one being added without that being a decision.
    for (const [name, preset] of Object.entries(WINDOW_PRESETS)) {
      expect("maxWidth" in preset, name).toBe(false);
      expect("maxHeight" in preset, name).toBe(false);
    }
  });

  it("gives the editors and the library more room than Record", () => {
    for (const name of ["videoEditor", "screenshotEditor", "library"] as const) {
      expect(WINDOW_PRESETS[name].minWidth, name).toBeGreaterThan(WINDOW_PRESETS.record.minWidth);
    }
  });
});

describe("presetForPath", () => {
  it("maps every route to its own preset", () => {
    for (const name of Object.keys(ROUTES) as RouteName[]) {
      // The parameterised route is matched by its concrete form below.
      if (ROUTES[name].includes(":")) continue;
      expect(presetForPath(ROUTES[name]), ROUTES[name]).toBe(name);
    }
  });

  it("treats a nested path as its parent screen", () => {
    expect(presetForPath("/library/abc-123")).toBe("libraryDetail");
    expect(presetForPath("/settings/general")).toBe("settings");
    expect(presetForPath("/settings/screenshots")).toBe("settings");
  });

  it("falls back to Record for anything unrecognised", () => {
    expect(presetForPath("/nope")).toBe("record");
  });
});

describe("fitPresetToDisplay", () => {
  it("leaves a preset alone on a display that fits it", () => {
    expect(fitPresetToDisplay(WINDOW_PRESETS.videoEditor, BIG)).toMatchObject(
      WINDOW_PRESETS.videoEditor,
    );
  });

  it("shrinks the size AND the minimum to the display", () => {
    // A minimum wider than the screen leaves a window that cannot be moved.
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
