import { describe, expect, it } from "vitest";
import {
  captureWhileRecordingEnabled,
  resolveCaptureWhileRecording,
  setReportedCaptureWhileRecording,
} from "./capture-while-recording";

describe("resolveCaptureWhileRecording", () => {
  it("is off by default", () => {
    expect(
      resolveCaptureWhileRecording({ platform: "darwin", override: undefined, reported: false }),
    ).toBe(false);
  });
  it("follows the reported flag on macOS", () => {
    expect(
      resolveCaptureWhileRecording({ platform: "darwin", override: undefined, reported: true }),
    ).toBe(true);
  });
  it("lets a local override win over the reported flag", () => {
    expect(
      resolveCaptureWhileRecording({ platform: "darwin", override: false, reported: true }),
    ).toBe(false);
    expect(
      resolveCaptureWhileRecording({ platform: "darwin", override: true, reported: false }),
    ).toBe(true);
  });
  it("is never on outside macOS", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(resolveCaptureWhileRecording({ platform, override: true, reported: true })).toBe(
        false,
      );
    }
  });
});

describe("Admin mode and the platform check (ADR 0067)", () => {
  // Admin mode forces the renderer's resolved `capture-while-recording` flag to true, and the
  // renderer reports that value to main. The flag only opens the feature; the platform check
  // still has the last word.
  it("stays off outside macOS even when Admin mode forced the reported flag on", () => {
    setReportedCaptureWhileRecording(true);
    try {
      expect(captureWhileRecordingEnabled("darwin")).toBe(true);
      expect(captureWhileRecordingEnabled("win32")).toBe(false);
      expect(captureWhileRecordingEnabled("linux")).toBe(false);
    } finally {
      setReportedCaptureWhileRecording(false);
    }
  });
});
