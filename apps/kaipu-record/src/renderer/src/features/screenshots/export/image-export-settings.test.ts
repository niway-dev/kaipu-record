import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_SETTINGS,
  extensionFor,
  flattensTransparency,
  mimeTypeFor,
  planExport,
  presetOf,
  sanitizeSettings,
  scaledSize,
  settingsForPreset,
  withChange,
} from "./image-export-settings";

describe("presets", () => {
  it("maps each preset to its settings", () => {
    expect(settingsForPreset("original")).toMatchObject({
      format: "png",
      scale: 1,
      maxSide: null,
    });
    expect(settingsForPreset("web")).toEqual({
      format: "webp",
      quality: 0.8,
      scale: 1,
      maxSide: 1920,
    });
    expect(settingsForPreset("small")).toEqual({
      format: "jpeg",
      quality: 0.7,
      scale: 1,
      maxSide: 1280,
    });
  });

  it("opens on Original, what Save writes", () => {
    expect(DEFAULT_EXPORT_SETTINGS.format).toBe("png");
    expect(DEFAULT_EXPORT_SETTINGS.scale).toBe(1);
    expect(presetOf(DEFAULT_EXPORT_SETTINGS)).toBe("original");
  });

  it("names the preset the settings equal, and Custom otherwise", () => {
    expect(presetOf(settingsForPreset("web"))).toBe("web");
    expect(presetOf(settingsForPreset("small"))).toBe("small");
    expect(presetOf({ ...settingsForPreset("web"), quality: 0.5 })).toBe("custom");
  });

  it("does not let a PNG's unused quality turn Original into Custom", () => {
    expect(presetOf({ ...settingsForPreset("original"), quality: 0.3 })).toBe("original");
  });

  it("leaves the preset on any edit, and drops the cap with it", () => {
    const edited = withChange(settingsForPreset("web"), { format: "jpeg" });
    expect(edited.maxSide).toBeNull();
    expect(presetOf(edited)).toBe("custom");
    expect(presetOf(withChange(settingsForPreset("web"), { scale: 2 }))).toBe("custom");
  });
});

describe("scaledSize", () => {
  it("multiplies by the scale", () => {
    expect(scaledSize(1000, 500, 0.5, null)).toEqual({ width: 500, height: 250 });
    expect(scaledSize(1000, 500, 1, null)).toEqual({ width: 1000, height: 500 });
    expect(scaledSize(1000, 500, 2, null)).toEqual({ width: 2000, height: 1000 });
  });

  it("shrinks the longest side to the cap, keeping the ratio", () => {
    expect(scaledSize(3840, 2160, 1, 1920)).toEqual({ width: 1920, height: 1080 });
    // Portrait: the height is the longest side.
    expect(scaledSize(1080, 3840, 1, 1920)).toEqual({ width: 540, height: 1920 });
  });

  it("never upscales to reach a cap", () => {
    expect(scaledSize(800, 600, 1, 1920)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(800, 600, 0.5, 1920)).toEqual({ width: 400, height: 300 });
  });

  it("applies the cap after the scale", () => {
    expect(scaledSize(1920, 1080, 2, 1920)).toEqual({ width: 1920, height: 1080 });
  });

  it("rounds to whole px and never goes below 1", () => {
    expect(scaledSize(101, 51, 0.5, null)).toEqual({ width: 51, height: 26 });
    expect(scaledSize(1, 1, 0.5, null)).toEqual({ width: 1, height: 1 });
  });
});

describe("planExport", () => {
  it("plans Web on a 4K frame: WebP at 0.8, 1920 px, composited at 1×", () => {
    expect(planExport(3840, 2160, settingsForPreset("web"))).toEqual({
      rasterScale: 1,
      width: 1920,
      height: 1080,
      mimeType: "image/webp",
      extension: "webp",
      quality: 0.8,
      flatten: false,
    });
  });

  it("does not upscale a small frame under the Web cap", () => {
    expect(planExport(800, 600, settingsForPreset("web"))).toMatchObject({
      width: 800,
      height: 600,
    });
  });

  it("composites at 2× for 2×, so annotations stay sharp", () => {
    const plan = planExport(1000, 500, { ...DEFAULT_EXPORT_SETTINGS, scale: 2 });
    expect(plan).toMatchObject({ rasterScale: 2, width: 2000, height: 1000 });
  });

  it("composites at 1× and shrinks for 0.5×", () => {
    const plan = planExport(1000, 500, { ...DEFAULT_EXPORT_SETTINGS, scale: 0.5 });
    expect(plan).toMatchObject({ rasterScale: 1, width: 500, height: 250 });
  });

  it("clamps the output with the compositor's raster limit instead of upscaling a smaller bitmap", () => {
    // 5000 px wide: the compositor cannot raster 2× inside 8192, so 2× is really 1×.
    const plan = planExport(5000, 3000, { ...DEFAULT_EXPORT_SETTINGS, scale: 2 });
    expect(plan.rasterScale).toBe(1);
    expect(plan).toMatchObject({ width: 5000, height: 3000 });
  });

  it("flattens only JPEG", () => {
    expect(planExport(10, 10, settingsForPreset("small")).flatten).toBe(true);
    expect(planExport(10, 10, settingsForPreset("web")).flatten).toBe(false);
    expect(planExport(10, 10, settingsForPreset("original")).flatten).toBe(false);
  });
});

describe("format helpers", () => {
  it("gives each format its extension and mime type", () => {
    expect(extensionFor("png")).toBe("png");
    expect(extensionFor("jpeg")).toBe("jpg");
    expect(extensionFor("webp")).toBe("webp");
    expect(mimeTypeFor("png")).toBe("image/png");
    expect(mimeTypeFor("jpeg")).toBe("image/jpeg");
    expect(mimeTypeFor("webp")).toBe("image/webp");
  });

  it("tells the person about the white only for JPEG with no background", () => {
    expect(flattensTransparency("jpeg", "none")).toBe(true);
    expect(flattensTransparency("jpeg", "dark")).toBe(false);
    expect(flattensTransparency("png", "none")).toBe(false);
    expect(flattensTransparency("webp", "none")).toBe(false);
  });
});

describe("sanitizeSettings", () => {
  it("keeps a valid value as it is", () => {
    const web = settingsForPreset("web");
    expect(sanitizeSettings(web)).toEqual(web);
  });

  it("falls back per field on anything unreadable or out of range", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(sanitizeSettings("webp")).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(sanitizeSettings({ format: "avif", quality: "high", scale: 3, maxSide: -5 })).toEqual(
      DEFAULT_EXPORT_SETTINGS,
    );
    expect(sanitizeSettings({ format: "jpeg", quality: 7 })).toMatchObject({
      format: "jpeg",
      quality: 1,
    });
    expect(sanitizeSettings({ quality: 0 }).quality).toBe(0.1);
  });
});
