import { describe, expect, it } from "vitest";
import { webcamTrackState } from "./webcam-track-state";

const meta = { startOffsetMs: 12, offsetQuality: "exact", width: 1280, height: 720, fps: 30 };

describe("webcamTrackState", () => {
  it("present with its meta when the file exists and the sidecar field is usable", () => {
    expect(webcamTrackState(true, meta)).toEqual({ state: "present", meta });
  });

  it("present with no meta when the file exists without a usable field (a recovered take)", () => {
    // The file must stay protected (remove-local-copy refuses), but the editor cannot use it.
    expect(webcamTrackState(true, undefined)).toEqual({ state: "present", meta: null });
    expect(webcamTrackState(true, { startOffsetMs: 0 })).toEqual({ state: "present", meta: null });
  });

  it("missing when the sidecar records a webcam whose file is gone", () => {
    expect(webcamTrackState(false, meta)).toEqual({ state: "missing", meta: null });
  });

  it("none without the file and without a usable field", () => {
    expect(webcamTrackState(false, undefined)).toEqual({ state: "none", meta: null });
    expect(webcamTrackState(false, { startOffsetMs: 0 })).toEqual({ state: "none", meta: null });
  });
});
