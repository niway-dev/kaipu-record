import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_SETTINGS,
  TRACK_KEYS,
  parseHiddenTracks,
  sanitizeEditorSettings,
} from "./editor-settings";

describe("TRACK_KEYS", () => {
  it("lists the lanes in timeline order, Clips first", () => {
    expect(TRACK_KEYS).toEqual([
      "clips",
      "annotations",
      "zooms",
      "activity",
      "webcam",
      "privacy",
      "audio",
    ]);
  });
});

describe("parseHiddenTracks", () => {
  it("returns an empty list for anything that is not an array", () => {
    expect(parseHiddenTracks(undefined)).toEqual([]);
    expect(parseHiddenTracks(null)).toEqual([]);
    expect(parseHiddenTracks("zooms")).toEqual([]);
    expect(parseHiddenTracks({ 0: "zooms" })).toEqual([]);
  });

  it("drops clips: the Clips lane can never be hidden, even by a stale or hand-edited file", () => {
    expect(parseHiddenTracks(["clips", "zooms"])).toEqual(["zooms"]);
  });

  it("drops unknown keys and non-strings, and de-duplicates", () => {
    expect(parseHiddenTracks(["zooms", "overlay", 3, null, "zooms", "audio"])).toEqual([
      "zooms",
      "audio",
    ]);
  });

  it("keeps activity as stored, even while zooms is not hidden", () => {
    expect(parseHiddenTracks(["activity"])).toEqual(["activity"]);
    expect(parseHiddenTracks(["zooms", "activity"])).toEqual(["zooms", "activity"]);
  });
});

describe("sanitizeEditorSettings", () => {
  it("defaults to every lane shown", () => {
    expect(DEFAULT_EDITOR_SETTINGS).toEqual({ hiddenTracks: [] });
    expect(sanitizeEditorSettings(undefined)).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(sanitizeEditorSettings("x")).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(sanitizeEditorSettings({})).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it("keeps a valid stored value and parses the list", () => {
    expect(sanitizeEditorSettings({ hiddenTracks: ["privacy", "clips", "nope"] })).toEqual({
      hiddenTracks: ["privacy"],
    });
  });
});
