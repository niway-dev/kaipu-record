import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/types";
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
    expect(mergeSettings({ theme: "dark", launchAtLogin: true })).toEqual({
      theme: "dark",
      launchAtLogin: true,
    });
  });

  it("falls back to defaults for invalid fields", () => {
    expect(mergeSettings({ theme: "neon" as never, launchAtLogin: "yes" as never })).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
