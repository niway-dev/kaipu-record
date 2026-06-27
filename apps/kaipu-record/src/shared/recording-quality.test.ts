import { describe, expect, it } from "vitest";
import {
  activePreset,
  DEFAULT_QUALITY,
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
