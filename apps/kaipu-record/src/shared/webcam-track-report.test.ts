import { describe, expect, it } from "vitest";
import { inspectWebcamTrack } from "./webcam-track-report";

const meta = {
  startOffsetMs: 40,
  offsetQuality: "exact" as const,
  width: 1280,
  height: 720,
  fps: 30,
};

const codes = (findings: { code: string }[]): string[] => findings.map((f) => f.code);

describe("inspectWebcamTrack", () => {
  it("passes a take whose webcam lines up with its screen", () => {
    const report = inspectWebcamTrack({
      meta,
      webcamFileExists: true,
      screen: { durationMs: 10_040 },
      webcam: { durationMs: 10_000, width: 1280, height: 720, fps: 30 },
    });
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("is an error when the sidecar has no webcam entry, or its file is gone", () => {
    expect(codes(inspectWebcamTrack({ meta: null, webcamFileExists: true }).findings)).toContain(
      "no-webcam-meta",
    );
    const missing = inspectWebcamTrack({ meta, webcamFileExists: false });
    expect(missing.ok).toBe(false);
    expect(codes(missing.findings)).toContain("webcam-file-missing");
  });

  it("warns when the offset is estimated", () => {
    const report = inspectWebcamTrack({
      meta: { ...meta, offsetQuality: "estimated" },
      webcamFileExists: true,
    });
    expect(report.ok).toBe(true);
    expect(codes(report.findings)).toEqual(["offset-estimated"]);
  });

  it("warns when screen − webcam − offset is more than 500 ms off", () => {
    const report = inspectWebcamTrack({
      meta,
      webcamFileExists: true,
      screen: { durationMs: 10_000 },
      webcam: { durationMs: 9_000 },
    });
    expect(codes(report.findings)).toEqual(["duration-mismatch"]);
    expect(report.findings[0]!.data).toEqual({ residualMs: 960 });
    // A webcam turned off mid-take is shorter on purpose: still worth a look, not an error.
    expect(report.ok).toBe(true);
  });

  it("warns when the file's size or frame rate is not what the sidecar says", () => {
    const report = inspectWebcamTrack({
      meta,
      webcamFileExists: true,
      webcam: { durationMs: 1000, width: 640, height: 480, fps: 15 },
    });
    expect(codes(report.findings)).toEqual(["size-mismatch", "fps-mismatch"]);
  });
});
