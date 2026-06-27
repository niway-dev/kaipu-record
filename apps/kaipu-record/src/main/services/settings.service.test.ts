import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/types";
import { DEFAULT_QUALITY, QUALITY_PRESETS } from "@shared/recording-quality";
import { isValidTheme, mergeSettings } from "./settings.service";

describe("isValidTheme", () => {
  it("accepts the known themes", () => {
    expect(isValidTheme("light")).toBe(true);
    expect(isValidTheme("dark")).toBe(true);
    expect(isValidTheme("system")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    expect(isValidTheme("blue")).toBe(false);
    expect(isValidTheme(undefined)).toBe(false);
    expect(isValidTheme(42)).toBe(false);
  });
});

describe("mergeSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid stored values", () => {
    expect(
      mergeSettings({
        theme: "dark",
        launchAtLogin: true,
        showInDock: false,
        recordingQuality: QUALITY_PRESETS.max,
      }),
    ).toEqual({
      theme: "dark",
      launchAtLogin: true,
      showInDock: false,
      recordingQuality: QUALITY_PRESETS.max,
    });
  });

  it("defaults showInDock to true when absent or invalid", () => {
    expect(mergeSettings({ theme: "dark" }).showInDock).toBe(true);
    expect(mergeSettings({ showInDock: "no" as never }).showInDock).toBe(true);
  });

  it("sanitizes recordingQuality — keeps valid, defaults garbage/absent", () => {
    expect(mergeSettings({}).recordingQuality).toEqual(DEFAULT_QUALITY);
    expect(
      mergeSettings({ recordingQuality: { resolution: 9, fps: 1, bitrate: "x" } as never })
        .recordingQuality,
    ).toEqual(DEFAULT_QUALITY);
    const custom = { resolution: 2160, fps: 48, bitrate: "max" } as const;
    expect(mergeSettings({ recordingQuality: custom }).recordingQuality).toEqual(custom);
  });

  it("falls back to defaults for invalid fields", () => {
    expect(
      mergeSettings({
        theme: "neon" as never,
        launchAtLogin: "yes" as never,
        showInDock: 1 as never,
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});
