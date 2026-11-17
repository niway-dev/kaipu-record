import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPORT_SETTINGS_KEY,
  readExportSettings,
  writeExportSettings,
} from "./export-settings-store";
import { DEFAULT_EXPORT_SETTINGS, settingsForPreset } from "./image-export-settings";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("export settings store", () => {
  it("starts from the defaults on a fresh machine", () => {
    expect(readExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it("remembers the last settings", () => {
    writeExportSettings(settingsForPreset("small"));
    expect(readExportSettings()).toEqual(settingsForPreset("small"));
  });

  it("reads a corrupt value as the defaults", () => {
    localStorage.setItem(EXPORT_SETTINGS_KEY, "{not json");
    expect(readExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it("survives a localStorage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readExportSettings()).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(() => writeExportSettings(settingsForPreset("web"))).not.toThrow();
  });
});
