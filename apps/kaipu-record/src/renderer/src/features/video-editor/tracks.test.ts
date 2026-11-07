import { describe, expect, it } from "vitest";
import * as shared from "@shared/editor-settings";
import {
  ALWAYS_SHOWN,
  TRACK_KEYS,
  availableTracks,
  isTrackHidden,
  parseHiddenTracks,
  trackForSelection,
  visibleCount,
} from "./tracks";

describe("the shared literals", () => {
  it("are the same lists the renderer reads (shared/ cannot import them as values)", () => {
    expect(TRACK_KEYS).toEqual(shared.TRACK_KEYS);
    expect(ALWAYS_SHOWN).toEqual(["clips"]);
    expect(parseHiddenTracks).toBe(shared.parseHiddenTracks);
  });
});

describe("availableTracks", () => {
  it("lists Clips, Annotations, Zooms, Privacy and Audio for a take with neither extra", () => {
    expect(availableTracks({ hasCursorTrack: false, hasWebcam: false })).toEqual([
      "clips",
      "annotations",
      "zooms",
      "privacy",
      "audio",
    ]);
  });

  it("adds Cursor activity only with a cursor track", () => {
    expect(availableTracks({ hasCursorTrack: true, hasWebcam: false })).toEqual([
      "clips",
      "annotations",
      "zooms",
      "activity",
      "privacy",
      "audio",
    ]);
  });

  it("adds Webcam only with a camera, in lane order", () => {
    expect(availableTracks({ hasCursorTrack: true, hasWebcam: true })).toEqual([
      "clips",
      "annotations",
      "zooms",
      "activity",
      "webcam",
      "privacy",
      "audio",
    ]);
    expect(availableTracks({ hasCursorTrack: false, hasWebcam: true })).toContain("webcam");
  });
});

describe("visibleCount", () => {
  const withCursor = availableTracks({ hasCursorTrack: true, hasWebcam: false });
  const plain = availableTracks({ hasCursorTrack: false, hasWebcam: false });

  it("counts every row of a take with a cursor track and no camera as 6/6", () => {
    expect(visibleCount(withCursor, [])).toEqual({ shown: 6, total: 6 });
  });

  it("reads 4/6 after hiding two independent lanes", () => {
    expect(visibleCount(withCursor, ["annotations", "privacy"])).toEqual({ shown: 4, total: 6 });
  });

  it("reads 5/5 without a cursor track", () => {
    expect(visibleCount(plain, [])).toEqual({ shown: 5, total: 5 });
  });

  it("never counts a hidden key the recording cannot show", () => {
    // `webcam` was hidden on another recording; this take has no camera.
    expect(visibleCount(plain, ["webcam", "activity"])).toEqual({ shown: 5, total: 5 });
  });

  it("counts the rows the timeline draws: Cursor activity is not shown while Zooms is hidden, whatever its stored value", () => {
    // ADR 0050 decision 5: n is visible rows. Zooms off takes its marks with it.
    expect(visibleCount(withCursor, ["zooms"])).toEqual({ shown: 4, total: 6 });
    expect(visibleCount(withCursor, ["zooms", "activity"])).toEqual({ shown: 4, total: 6 });
    expect(visibleCount(withCursor, ["activity"])).toEqual({ shown: 5, total: 6 });
  });

  it("never counts Clips as hidden", () => {
    expect(visibleCount(plain, ["clips"] as never)).toEqual({ shown: 5, total: 5 });
  });
});

describe("isTrackHidden", () => {
  it("is true for a stored key and false otherwise", () => {
    expect(isTrackHidden("zooms", ["zooms"])).toBe(true);
    expect(isTrackHidden("audio", ["zooms"])).toBe(false);
  });

  it("is never true for Clips", () => {
    expect(isTrackHidden("clips", ["clips"] as never)).toBe(false);
  });

  it("hides the marks with Zooms, and with their own flag", () => {
    expect(isTrackHidden("activity", ["zooms"])).toBe(true);
    expect(isTrackHidden("activity", ["activity"])).toBe(true);
    expect(isTrackHidden("activity", [])).toBe(false);
  });

  it("shows a lane this build does not know: never hide what the user has no row to turn back on", () => {
    expect(isTrackHidden("overlay" as never, [])).toBe(false);
    expect(isTrackHidden("overlay" as never, ["zooms"])).toBe(false);
    // And it counts as drawn when a take lists it.
    expect(visibleCount(["clips", "overlay" as never], [])).toEqual({ shown: 2, total: 2 });
  });
});

describe("trackForSelection", () => {
  it("maps each selectable kind to the lane that draws it", () => {
    expect(trackForSelection("overlay")).toBe("annotations");
    expect(trackForSelection("zoom")).toBe("zooms");
    expect(trackForSelection("redaction")).toBe("privacy");
    expect(trackForSelection("mute")).toBe("audio");
    expect(trackForSelection("webcam")).toBe("webcam");
    expect(trackForSelection("item")).toBeNull();
  });
});
