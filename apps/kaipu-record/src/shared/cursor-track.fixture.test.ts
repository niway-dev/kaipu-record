/**
 * Documents what a REAL cursor track looks like, using a real 25 s screen
 * recording (`src/shared/__fixtures__/real-screen-2026-09-22.*`) captured before
 * the tail-cut fix (recorder-store.ts, recording-hub.ts) landed. See
 * `apps/documentation/src/content/docs/testing/cursor-track-check.md` for how to
 * add another fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCursorTrack } from "./cursor-track";
import { inspectCursorTrack } from "./cursor-track-report";

const FIXTURES_DIR = join(__dirname, "__fixtures__");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as T;
}

const trackJson = readFileSync(join(FIXTURES_DIR, "real-screen-2026-09-22.cursor.json"), "utf8");
const track = parseCursorTrack(trackJson);
const meta = readJson<{ durationSeconds: number }>("real-screen-2026-09-22.meta.json");

describe("real-screen-2026-09-22 fixture", () => {
  it("parses", () => {
    expect(track).not.toBeNull();
  });

  it("has the expected shape", () => {
    expect(track?.version).toBe(1);
    expect(track?.anchor).toBe("exact");
    expect(track?.display).toEqual({ id: "2", width: 1920, height: 1080, scaleFactor: 1 });
    expect(track?.clicksAvailable).toBe(false);
    expect(track?.t).toHaveLength(1226);
    expect(track?.clicks).toHaveLength(0);
    expect(track?.truncatedAtMs).toBeUndefined();
  });

  it("inspects clean against the sidecar's (floored) duration", () => {
    if (!track) throw new Error("fixture did not parse");
    const report = inspectCursorTrack(track, { durationMs: meta.durationSeconds * 1000 });

    expect(report.ok).toBe(true);

    const gapFindings = report.findings.filter((f) => f.code === "gap");
    expect(gapFindings).toHaveLength(1);
    expect(gapFindings[0].level).toBe("ok");
    expect(gapFindings[0].data).toEqual({ atMs: 19026, gapMs: 2215, moved: false });

    // The first two samples (t=2471, t=2481) have different positions, but this is
    // NOT evidence of dropped samples: the pointer was idle before its first move
    // and CursorSampleBuffer collapses every identical-position sample before a
    // move into one entry, so a track can legitimately start late.
    const lateStartFindings = report.findings.filter((f) => f.code === "late-start");
    expect(lateStartFindings).toHaveLength(1);
    expect(lateStartFindings[0].level).toBe("ok");
    expect(lateStartFindings[0].data).toEqual({ firstMs: 2471 });

    const tailFinding = report.findings.find((f) => f.code === "tail-coverage");
    expect(tailFinding?.level).toBe("ok");
  });

  it("shows a tail-coverage warn against the true (unfloored) media duration", () => {
    if (!track) throw new Error("fixture did not parse");
    // The real video track is 1245 frames at 48 fps ≈ 25 900 ms. The sidecar's
    // `durationSeconds` (25) is `Math.floor(elapsedMs / 1000)` — up to ~1 s of real
    // media time is not represented in `meta.durationSeconds * 1000`. This is the
    // exact bug fix §4 addresses (RecordingFinalizeMeta.durationMs); this assertion
    // documents why the fix exists and pins the behavior it is fixing.
    const report = inspectCursorTrack(track, { durationMs: 25_900 });
    const tailFinding = report.findings.find((f) => f.code === "tail-coverage");
    expect(tailFinding?.level).toBe("warn");
    expect(tailFinding?.data).toEqual({ lastMs: 24_994, durationMs: 25_900, missingMs: 906 });
  });

  it("stays small", () => {
    if (!track) throw new Error("fixture did not parse");
    const report = inspectCursorTrack(track);
    expect(report.bytes).toBeLessThan(30_000);
  });
});
