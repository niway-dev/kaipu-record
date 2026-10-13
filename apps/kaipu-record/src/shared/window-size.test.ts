import { describe, expect, it } from "vitest";
import { ROUTES } from "./routes";
import {
  boundsAroundCenter,
  fitPresetToDisplay,
  isEditorPreset,
  presetForPath,
  WINDOW_PRESETS,
} from "./window-size";

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
      // The screenshot editor and the Editor home share the window too: only video
      // takes it over.
      ROUTES.screenshotEditor,
      ROUTES.editor,
      "/editor/image/asset-1",
      ROUTES.editorCapture,
    ];
    for (const path of sidebar) expect(presetForPath(path), path).toBe("main");
  });

  it("gives only the video editor its own", () => {
    expect(presetForPath("/editor/video/asset-1")).toBe("videoEditor");
  });

  it("leaves the legacy /video-editor redirect on main (it redirects at once)", () => {
    expect(presetForPath(ROUTES.videoEditor)).toBe("main");
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

describe("boundsAroundCenter", () => {
  const area = { x: 0, y: 25, width: 1920, height: 1055 };

  it("grows in every direction around the window's centre", () => {
    // A 1040x760 window centred on a 1920-wide screen, growing into the editor.
    const current = { x: 440, y: 172, width: 1040, height: 760 };
    const next = boundsAroundCenter(current, { width: 1440, height: 900 }, area);

    expect(next).toEqual({ x: 240, y: 102, width: 1440, height: 900 });
    // Same centre before and after: it did not just stretch right and down.
    expect(next.x + next.width / 2).toBe(current.x + current.width / 2);
    expect(next.y + next.height / 2).toBe(current.y + current.height / 2);
  });

  it("slides back inside the work area instead of crossing an edge", () => {
    // Placed near the top-left: growing around the centre would cross both edges.
    const current = { x: 10, y: 30, width: 1040, height: 760 };
    const next = boundsAroundCenter(current, { width: 1440, height: 900 }, area);

    expect(next.x).toBe(area.x);
    expect(next.y).toBe(area.y);
    expect(next.width).toBe(1440);
    expect(next.height).toBe(900);
  });

  it("keeps the window on a display that does not start at the origin", () => {
    // A second display to the right, with its own work area.
    const second = { x: 1920, y: 0, width: 1440, height: 875 };
    const current = { x: 2900, y: 400, width: 1040, height: 760 };
    const next = boundsAroundCenter(current, { width: 1440, height: 900 }, second);

    expect(next.x).toBe(1920);
    expect(next.y).toBe(0);
    expect(next.width).toBe(1440);
    // Taller than the display: it gets all the height there is.
    expect(next.height).toBe(875);
  });
});
