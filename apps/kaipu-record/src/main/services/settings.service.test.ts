import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS } from "@shared/types";
import { DEFAULT_QUALITY, QUALITY_PRESETS } from "@shared/recording-quality";
import { DEFAULT_LOCALE } from "@kaipu/i18n";
import { isValidTheme, mergeSettings, mergeShortcuts } from "./settings.service";

describe("DEFAULT_SETTINGS", () => {
  // `@shared/types` cannot import the i18n package (preload bundle), so its
  // locale default is a literal. This is the guard that keeps the copy honest.
  it("uses the same locale default as @kaipu/i18n", () => {
    expect(DEFAULT_SETTINGS.locale).toBe(DEFAULT_LOCALE);
  });
});

describe("isValidTheme", () => {
  it("accepts the known themes", () => {
    expect(isValidTheme("light")).toBe(true);
    expect(isValidTheme("dark")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    // "system" is a legacy stored value from builds that declared but never
    // applied it — it must coerce to the dark default via mergeSettings.
    expect(isValidTheme("system")).toBe(false);
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
    const shortcuts = {
      startRecording: "Command+Control+1",
      stopRecording: "Command+Control+2",
      bringToFront: "Command+Control+3",
      captureScreenshot: "Command+Control+4",
      toggleMicrophone: "Command+Control+5",
      toggleSystemAudio: "Command+Control+6",
      toggleCamera: "Command+Control+7",
    };
    expect(
      mergeSettings({
        theme: "dark",
        locale: "en",
        launchAtLogin: true,
        showInDock: false,
        recordingQuality: QUALITY_PRESETS.max,
        showBarInRecording: true,
        screenshotSave: "manual",
        showBrandBadge: true,
        screenshotCopy: "manual",
        shortcuts,
        deviceId: "stored-id",
        uploadMode: "manual",
      }),
    ).toEqual({
      theme: "dark",
      locale: "en",
      launchAtLogin: true,
      showInDock: false,
      recordingQuality: QUALITY_PRESETS.max,
      showBarInRecording: true,
      screenshotSave: "manual",
      showBrandBadge: true,
      screenshotCopy: "manual",
      shortcuts,
      deviceId: "stored-id",
      uploadMode: "manual",
    });
  });

  it('coerces a legacy persisted "system" theme to the dark default', () => {
    expect(mergeSettings({ theme: "system" as never }).theme).toBe("dark");
  });

  it("keeps a valid persisted locale and defaults an invalid one", () => {
    expect(mergeSettings({ locale: "es" }).locale).toBe("es");
    expect(mergeSettings({ locale: "fr" as never }).locale).toBe("en");
    expect(mergeSettings({}).locale).toBe("en");
  });

  it("defaults showBarInRecording to false when absent or invalid", () => {
    expect(mergeSettings({}).showBarInRecording).toBe(false);
    expect(mergeSettings({ showBarInRecording: "yes" as never }).showBarInRecording).toBe(false);
  });

  it("fills in default shortcuts when absent", () => {
    expect(mergeSettings({}).shortcuts).toEqual(DEFAULT_SHORTCUTS);
  });

  it("defaults showInDock to true when absent or invalid", () => {
    expect(mergeSettings({ theme: "dark" }).showInDock).toBe(true);
    expect(mergeSettings({ showInDock: "no" as never }).showInDock).toBe(true);
  });

  it("sanitizes recordingQuality — keeps valid, defaults garbage/absent", () => {
    expect(mergeSettings({}).recordingQuality).toEqual(DEFAULT_QUALITY);
    expect(
      mergeSettings({
        recordingQuality: { resolution: 9, fps: 1, bitrate: "x" } as never,
      }).recordingQuality,
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

describe("mergeShortcuts", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(mergeShortcuts(null)).toEqual(DEFAULT_SHORTCUTS);
    expect(mergeShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
    expect(mergeShortcuts("garbage")).toEqual(DEFAULT_SHORTCUTS);
  });

  it("keeps valid per-action bindings and defaults the rest", () => {
    expect(
      mergeShortcuts({
        startRecording: "Command+Control+G",
        stopRecording: "",
      }),
    ).toEqual({
      startRecording: "Command+Control+G",
      stopRecording: DEFAULT_SHORTCUTS.stopRecording,
      bringToFront: DEFAULT_SHORTCUTS.bringToFront,
      captureScreenshot: DEFAULT_SHORTCUTS.captureScreenshot,
      toggleMicrophone: DEFAULT_SHORTCUTS.toggleMicrophone,
      toggleSystemAudio: DEFAULT_SHORTCUTS.toggleSystemAudio,
      toggleCamera: DEFAULT_SHORTCUTS.toggleCamera,
    });
  });

  it("gives settings stored before the live toggles existed their new defaults", () => {
    const merged = mergeShortcuts({
      startRecording: "Command+Control+1",
      stopRecording: "Command+Control+2",
      bringToFront: "Command+Control+3",
      captureScreenshot: "Command+Control+4",
    });
    expect(merged.toggleMicrophone).toBe("Command+Control+M");
    expect(merged.toggleSystemAudio).toBe("Command+Control+A");
    expect(merged.toggleCamera).toBe("Command+Control+K");
  });

  it("ignores non-string bindings", () => {
    expect(mergeShortcuts({ bringToFront: 42 }).bringToFront).toBe(DEFAULT_SHORTCUTS.bringToFront);
  });
});

describe("deviceId", () => {
  it("defaults to an empty string (the store fills it in)", () => {
    expect(mergeSettings(null).deviceId).toBe("");
  });

  it("preserves a stored device id", () => {
    expect(mergeSettings({ deviceId: "abc-123" }).deviceId).toBe("abc-123");
  });

  it("ignores a non-string device id", () => {
    expect(mergeSettings({ deviceId: 42 as unknown as string }).deviceId).toBe("");
  });
});

describe("uploadMode", () => {
  it("defaults to local-only, so creating an account never starts uploads", () => {
    expect(mergeSettings(null).uploadMode).toBe("local-only");
    expect(mergeSettings({ theme: "light" }).uploadMode).toBe("local-only");
  });

  it("keeps each valid mode", () => {
    for (const mode of ["local-only", "manual", "automatic"] as const) {
      expect(mergeSettings({ uploadMode: mode }).uploadMode).toBe(mode);
    }
  });

  it("drops an unknown mode instead of persisting it", () => {
    expect(mergeSettings({ uploadMode: "everything" as unknown as "manual" }).uploadMode).toBe(
      "local-only",
    );
  });
});

describe("screenshotSave", () => {
  it("defaults to auto", () => {
    expect(DEFAULT_SETTINGS.screenshotSave).toBe("auto");
    expect(mergeSettings(null).screenshotSave).toBe("auto");
  });

  it("keeps a valid stored mode and coerces anything else to the default", () => {
    expect(mergeSettings({ screenshotSave: "manual" }).screenshotSave).toBe("manual");
    expect(mergeSettings({ screenshotSave: "always" as never }).screenshotSave).toBe("auto");
    expect(mergeSettings({ screenshotSave: 3 as never }).screenshotSave).toBe("auto");
  });
});

describe("showBrandBadge", () => {
  it("defaults to off — the free app carries no watermark", () => {
    expect(DEFAULT_SETTINGS.showBrandBadge).toBe(false);
    expect(mergeSettings(null).showBrandBadge).toBe(false);
  });

  it("keeps a stored boolean and coerces anything else to off", () => {
    expect(mergeSettings({ showBrandBadge: true }).showBrandBadge).toBe(true);
    expect(mergeSettings({ showBrandBadge: "yes" as never }).showBrandBadge).toBe(false);
  });
});

describe("screenshotCopy", () => {
  it("defaults to auto", () => {
    expect(DEFAULT_SETTINGS.screenshotCopy).toBe("auto");
    expect(mergeSettings(null).screenshotCopy).toBe("auto");
  });

  it("keeps a valid stored mode and coerces anything else to the default", () => {
    expect(mergeSettings({ screenshotCopy: "manual" }).screenshotCopy).toBe("manual");
    expect(mergeSettings({ screenshotCopy: "always" as never }).screenshotCopy).toBe("auto");
    expect(mergeSettings({ screenshotCopy: 3 as never }).screenshotCopy).toBe("auto");
  });

  it("is independent of screenshotSave — every combination survives a merge", () => {
    expect(mergeSettings({ screenshotSave: "manual", screenshotCopy: "auto" })).toMatchObject({
      screenshotSave: "manual",
      screenshotCopy: "auto",
    });
    expect(mergeSettings({ screenshotSave: "auto", screenshotCopy: "manual" })).toMatchObject({
      screenshotSave: "auto",
      screenshotCopy: "manual",
    });
  });
});
