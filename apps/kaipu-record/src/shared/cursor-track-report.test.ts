import { describe, expect, it } from "vitest";
import type { CursorTrack } from "./cursor-track";
import { inspectCursorTrack } from "./cursor-track-report";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

function track(partial: Partial<CursorTrack> = {}): CursorTrack {
  return {
    version: 1,
    display: DISPLAY,
    anchor: "exact",
    clicksAvailable: true,
    t: [0, 10, 20],
    x: [0.1, 0.2, 0.3],
    y: [0.1, 0.2, 0.3],
    clicks: [],
    ...partial,
  };
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

describe("inspectCursorTrack", () => {
  it("reports a clean track as ok with no findings beyond rate", () => {
    const report = inspectCursorTrack(track());
    expect(report.ok).toBe(true);
    expect(report.samples).toBe(3);
    expect(report.clicks).toBe(0);
    expect(report.firstMs).toBe(0);
    expect(report.lastMs).toBe(20);
    expect(report.bytes).toBeGreaterThan(0);
  });

  it("flags anchor-estimated as warn", () => {
    const report = inspectCursorTrack(track({ anchor: "estimated" }));
    const f = report.findings.find((f) => f.code === "anchor-estimated");
    expect(f?.level).toBe("warn");
  });

  it("flags t-unsorted as error and clears ok", () => {
    const report = inspectCursorTrack(track({ t: [10, 0, 20] }));
    const f = report.findings.find((f) => f.code === "t-unsorted");
    expect(f?.level).toBe("error");
    expect(report.ok).toBe(false);
  });

  it("flags arrays-mismatched as error", () => {
    const report = inspectCursorTrack(track({ x: [0.1, 0.2] }));
    const f = report.findings.find((f) => f.code === "arrays-mismatched");
    expect(f?.level).toBe("error");
    expect(report.ok).toBe(false);
  });

  it("flags empty as warn", () => {
    const report = inspectCursorTrack(track({ t: [], x: [], y: [] }));
    const f = report.findings.find((f) => f.code === "empty");
    expect(f?.level).toBe("warn");
    expect(report.firstMs).toBeNull();
    expect(report.lastMs).toBeNull();
  });

  it("flags out-of-display as warn with a count", () => {
    const report = inspectCursorTrack(
      track({ t: [0, 10, 20], x: [1.5, 0.2, -0.1], y: [0.1, 0.2, 0.3] }),
    );
    const f = report.findings.find((f) => f.code === "out-of-display");
    expect(f?.level).toBe("warn");
    expect(f?.data).toEqual({ count: 2 });
  });

  it("flags truncated as warn with atMs", () => {
    const report = inspectCursorTrack(track({ truncatedAtMs: 15 }));
    const f = report.findings.find((f) => f.code === "truncated");
    expect(f?.level).toBe("warn");
    expect(f?.data).toEqual({ atMs: 15 });
  });

  it("flags an idle gap as ok when the position did not change", () => {
    const report = inspectCursorTrack(track({ t: [0, 2000], x: [0.1, 0.1], y: [0.2, 0.2] }));
    const f = report.findings.find((f) => f.code === "gap");
    expect(f?.level).toBe("ok");
    expect(f?.data).toEqual({ atMs: 0, gapMs: 2000, moved: false });
    expect(report.ok).toBe(true);
  });

  it("flags a moving gap as warn when the position changed", () => {
    const report = inspectCursorTrack(track({ t: [0, 2000], x: [0.1, 0.9], y: [0.2, 0.8] }));
    const f = report.findings.find((f) => f.code === "gap");
    expect(f?.level).toBe("warn");
    expect(f?.data).toMatchObject({ moved: true });
  });

  it("flags late-start as ok (informational) when the first two samples differ", () => {
    const report = inspectCursorTrack(
      track({ t: [2000, 2010, 2020], x: [0.1, 0.2, 0.3], y: [0.1, 0.2, 0.3] }),
    );
    const f = report.findings.find((f) => f.code === "late-start");
    expect(f?.level).toBe("ok");
    expect(f?.data).toEqual({ firstMs: 2000 });
  });

  it("does not flag late-start when the first two samples share a position", () => {
    const report = inspectCursorTrack(
      track({ t: [2000, 2010, 2020], x: [0.1, 0.1, 0.3], y: [0.1, 0.1, 0.3] }),
    );
    expect(codes(report.findings)).not.toContain("late-start");
  });

  it("does not flag late-start when firstMs <= 1000", () => {
    const report = inspectCursorTrack(
      track({ t: [1000, 1010, 1020], x: [0.1, 0.2, 0.3], y: [0.1, 0.2, 0.3] }),
    );
    expect(codes(report.findings)).not.toContain("late-start");
  });

  it("flags tail-coverage ok when the last sample covers the media duration", () => {
    const report = inspectCursorTrack(track({ t: [0, 10, 24800] }), { durationMs: 25000 });
    const f = report.findings.find((f) => f.code === "tail-coverage");
    expect(f?.level).toBe("ok");
  });

  it("flags tail-coverage warn when the track ends well before the media", () => {
    const report = inspectCursorTrack(track({ t: [0, 10, 24000] }), { durationMs: 25000 });
    const f = report.findings.find((f) => f.code === "tail-coverage");
    expect(f?.level).toBe("warn");
    expect(f?.data).toEqual({ lastMs: 24000, durationMs: 25000, missingMs: 1000 });
  });

  it("flags tail-coverage error when samples exist past the media end", () => {
    const report = inspectCursorTrack(track({ t: [0, 10, 25100] }), { durationMs: 25000 });
    const f = report.findings.find((f) => f.code === "tail-coverage");
    expect(f?.level).toBe("error");
    expect(report.ok).toBe(false);
  });

  it("flags clicks-unavailable as ok when clicksAvailable is false", () => {
    const report = inspectCursorTrack(track({ clicksAvailable: false }));
    const f = report.findings.find((f) => f.code === "clicks-unavailable");
    expect(f?.level).toBe("ok");
  });

  it("does not flag clicks-unavailable when clicksAvailable is true", () => {
    const report = inspectCursorTrack(track({ clicksAvailable: true }));
    expect(codes(report.findings)).not.toContain("clicks-unavailable");
  });

  it("flags rate as ok at 50 Hz or faster", () => {
    const report = inspectCursorTrack(
      track({ t: [0, 8, 16, 24], x: [0, 0.1, 0.2, 0.3], y: [0, 0.1, 0.2, 0.3] }),
    );
    const f = report.findings.find((f) => f.code === "rate");
    expect(f?.level).toBe("ok");
    expect(f?.data).toEqual({ medianMs: 8 });
  });

  it("flags rate as warn when slower than 50 Hz", () => {
    const report = inspectCursorTrack(
      track({ t: [0, 30, 60, 90], x: [0, 0.1, 0.2, 0.3], y: [0, 0.1, 0.2, 0.3] }),
    );
    const f = report.findings.find((f) => f.code === "rate");
    expect(f?.level).toBe("warn");
  });

  it("is deterministic", () => {
    const t = track({ t: [0, 10, 2000], x: [0.1, 0.1, 0.1], y: [0.2, 0.2, 0.2] });
    const a = inspectCursorTrack(t, { durationMs: 3000 });
    const b = inspectCursorTrack(t, { durationMs: 3000 });
    expect(a).toEqual(b);
  });
});
