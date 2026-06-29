import { describe, expect, it } from "vitest";
import {
  activePreset,
  DEFAULT_QUALITY,
  fitToCap,
  mbPerMinute,
  qualityToEngine,
  QUALITY_PRESETS,
  sanitizeQuality,
  type RecordingQuality,
} from "./recording-quality";

describe("recording-quality", () => {
  it("each named preset round-trips through activePreset", () => {
    expect(activePreset(QUALITY_PRESETS.light)).toBe("light");
    expect(activePreset(QUALITY_PRESETS.balanced)).toBe("balanced");
    expect(activePreset(QUALITY_PRESETS.max)).toBe("max");
  });

  it("derives 'custom' when a combo matches no preset", () => {
    const tweaked: RecordingQuality = { ...QUALITY_PRESETS.balanced, resolution: 2160 };
    expect(activePreset(tweaked)).toBe("custom");
  });

  it("defaults to the balanced preset", () => {
    expect(DEFAULT_QUALITY).toEqual(QUALITY_PRESETS.balanced);
    expect(activePreset(DEFAULT_QUALITY)).toBe("balanced");
  });

  it("reports plain MB-per-minute per bitrate tier", () => {
    expect(mbPerMinute("light")).toBe(30);
    expect(mbPerMinute("medium")).toBe(60);
    expect(mbPerMinute("high")).toBe(120);
    expect(mbPerMinute("max")).toBe(180);
  });

  it("maps a combo to real encoder parameters", () => {
    expect(qualityToEngine(QUALITY_PRESETS.balanced)).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoBitrate: 8_000_000,
    });
    expect(qualityToEngine(QUALITY_PRESETS.max)).toEqual({
      width: 2560,
      height: 1440,
      frameRate: 60,
      videoBitrate: 16_000_000,
    });
  });

  it("sanitizes a valid stored combo unchanged", () => {
    const stored = { resolution: 1440, fps: 48, bitrate: "high" };
    expect(sanitizeQuality(stored)).toEqual(stored);
  });

  it("falls back to defaults for garbage or partial input", () => {
    expect(sanitizeQuality(null)).toEqual(DEFAULT_QUALITY);
    expect(sanitizeQuality({ resolution: 999, fps: "fast", bitrate: "ultra" })).toEqual(
      DEFAULT_QUALITY,
    );
    expect(sanitizeQuality({ resolution: 720 })).toEqual({
      resolution: 720,
      fps: DEFAULT_QUALITY.fps,
      bitrate: DEFAULT_QUALITY.bitrate,
    });
  });
});

describe("fitToCap", () => {
  it("preserves a non-16:9 screen's real aspect ratio (the Mac bug)", () => {
    // 14" MacBook Pro panel: 3024×1964 (AR 1.540), NOT 16:9.
    const fit = fitToCap(3024, 1964, 1080);
    expect(fit).toEqual({ width: 1662, height: 1080 });
    // AR must match the source, not be forced to 16:9 (1.778).
    expect(fit.width / fit.height).toBeCloseTo(3024 / 1964, 2);
  });

  it("leaves a real 16:9 source untouched", () => {
    expect(fitToCap(1920, 1080, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("preserves a 16:10 panel (MacBook Air / older Macs)", () => {
    // 2560×1600 (AR 1.60) → 1728×1080, not 1920×1080.
    const fit = fitToCap(2560, 1600, 1080);
    expect(fit).toEqual({ width: 1728, height: 1080 });
    expect(fit.width / fit.height).toBeCloseTo(2560 / 1600, 2);
  });

  it("never upscales a source smaller than the cap", () => {
    // 1280×720 with a 1080 cap stays native — no blurry upscale.
    expect(fitToCap(1280, 720, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it("caps an ultrawide by height and lets width follow the AR", () => {
    expect(fitToCap(3440, 1440, 1080)).toEqual({ width: 2580, height: 1080 });
  });

  it("preserves a portrait source", () => {
    const fit = fitToCap(1080, 1920, 1080);
    expect(fit.height).toBe(1080);
    expect(fit.width / fit.height).toBeCloseTo(1080 / 1920, 2);
  });

  it("always returns even dimensions (H.264 requires it)", () => {
    const fit = fitToCap(3023, 1963, 1080);
    expect(fit.width % 2).toBe(0);
    expect(fit.height % 2).toBe(0);
  });
});
