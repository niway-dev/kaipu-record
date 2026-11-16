import { describe, expect, it } from "vitest";
import { planSegments, speechThresholdDb, voicedMs } from "./segment";

const FRAME_MS = 20;

/** `loudDb` everywhere, `quietDb` inside each [fromMs, toMs) gap. */
function levelsFor(
  durationMs: number,
  gaps: Array<[number, number]> = [],
  loudDb = -20,
  quietDb = -80,
): Float32Array {
  const out = new Float32Array(Math.floor(durationMs / FRAME_MS)).fill(loudDb);
  for (const [from, to] of gaps) {
    for (let f = Math.floor(from / FRAME_MS); f < Math.floor(to / FRAME_MS); f++) out[f] = quietDb;
  }
  return out;
}

describe("planSegments windows", () => {
  const plan = (durationMs: number) => planSegments({ durationMs, levels: levelsFor(durationMs) });

  it("makes one segment for a recording shorter than a window", () => {
    const { segments, seams } = plan(20_000);
    expect(segments).toEqual([{ id: "s0", startMs: 0, endMs: 20_000 }]);
    expect(seams).toEqual([]);
  });

  it("makes one segment for exactly one window", () => {
    const { segments, seams } = plan(30_000);
    expect(segments).toEqual([{ id: "s0", startMs: 0, endMs: 30_000 }]);
    expect(seams).toEqual([]);
  });

  it("makes a short second window for 31 s", () => {
    const { segments, seams } = plan(31_000);
    expect(segments).toEqual([
      { id: "s0", startMs: 0, endMs: 30_000 },
      { id: "s1", startMs: 27_000, endMs: 31_000 },
    ]);
    expect(seams).toHaveLength(1);
  });

  it("advances by window minus overlap and ends exactly at the duration for 95 s", () => {
    const { segments, seams } = plan(95_000);
    expect(segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 30_000],
      [27_000, 57_000],
      [54_000, 84_000],
      [81_000, 95_000],
    ]);
    expect(segments.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(seams).toHaveLength(3);
    for (let i = 0; i < seams.length; i++) {
      expect(seams[i]!.beforeId).toBe(`s${i}`);
      expect(seams[i]!.afterId).toBe(`s${i + 1}`);
      expect(seams[i]!.overlapEndMs - seams[i]!.overlapStartMs).toBe(3000);
    }
  });

  it("is deterministic and honours custom windows", () => {
    const a = planSegments({
      durationMs: 50_000,
      levels: levelsFor(50_000),
      windowMs: 20_000,
      overlapMs: 2000,
    });
    const b = planSegments({
      durationMs: 50_000,
      levels: levelsFor(50_000),
      windowMs: 20_000,
      overlapMs: 2000,
    });
    expect(a).toEqual(b);
    expect(a.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 20_000],
      [18_000, 38_000],
      [36_000, 50_000],
    ]);
  });

  it("returns no segments for an empty recording and rejects a bad window", () => {
    expect(planSegments({ durationMs: 0, levels: new Float32Array(0) }).segments).toEqual([]);
    expect(() =>
      planSegments({
        durationMs: 10_000,
        levels: levelsFor(10_000),
        windowMs: 3000,
        overlapMs: 3000,
      }),
    ).toThrow();
  });
});

describe("planSegments seams", () => {
  it("cuts inside the middle 60% of the overlap", () => {
    const { seams } = planSegments({ durationMs: 60_000, levels: levelsFor(60_000) });
    for (const seam of seams) {
      const span = seam.overlapEndMs - seam.overlapStartMs;
      expect(seam.cutMs).toBeGreaterThanOrEqual(seam.overlapStartMs + span * 0.2);
      expect(seam.cutMs).toBeLessThanOrEqual(seam.overlapEndMs - span * 0.2);
      expect(Number.isInteger(seam.cutMs)).toBe(true);
    }
  });

  it("lands on a quiet gap inside the overlap when one exists", () => {
    // Overlap of the first pair is 27 000 to 30 000; the gap is 28 400 to 28 700.
    const levels = levelsFor(60_000, [[28_400, 28_700]]);
    const { seams } = planSegments({ durationMs: 60_000, levels });
    expect(seams[0]!.cutMs).toBeGreaterThanOrEqual(28_400);
    expect(seams[0]!.cutMs).toBeLessThanOrEqual(28_700);
  });

  it("ignores a quiet gap outside the middle 60%", () => {
    // 27 100 to 27 500 is inside the overlap but in its first 20%, so it cannot be the cut.
    const levels = levelsFor(60_000, [[27_100, 27_500]]);
    const { seams } = planSegments({ durationMs: 60_000, levels });
    // The seam clamps to 27 600 (the start of the middle 60%). A search over the whole overlap
    // would pick the gap's centre and be clamped to exactly 27 600; the restricted search ties
    // to its first frame, 27 610. Strictly greater tells the two apart.
    expect(seams[0]!.cutMs).toBeGreaterThan(27_600);
  });

  it("copes with levels shorter than the audio", () => {
    const { seams } = planSegments({ durationMs: 60_000, levels: new Float32Array(0) });
    for (const seam of seams) {
      expect(seam.cutMs).toBeGreaterThanOrEqual(seam.overlapStartMs);
      expect(seam.cutMs).toBeLessThanOrEqual(seam.overlapEndMs);
    }
  });
});

describe("speechThresholdDb and voicedMs", () => {
  it("sets the threshold at the 10th percentile plus the margin", () => {
    const levels = new Float32Array(100).fill(-20);
    for (let i = 0; i < 20; i++) levels[i] = -70;
    expect(speechThresholdDb(levels)).toBe(-70 + 12);
    expect(speechThresholdDb(levels, 6)).toBe(-70 + 6);
  });

  it("counts frames above the threshold inside the segment", () => {
    const levels = levelsFor(10_000, [[0, 2000]]); // silence 0-2 s, then loud
    const threshold = speechThresholdDb(levels);
    expect(voicedMs(levels, { id: "s0", startMs: 0, endMs: 10_000 }, threshold)).toBe(8000);
    expect(voicedMs(levels, { id: "s1", startMs: 0, endMs: 2000 }, threshold)).toBe(0);
    expect(voicedMs(levels, { id: "s2", startMs: 1000, endMs: 4000 }, threshold)).toBe(2000);
  });

  it("returns 0 for a segment past the levels", () => {
    const levels = levelsFor(1000);
    expect(voicedMs(levels, { id: "s0", startMs: 5000, endMs: 9000 }, -50)).toBe(0);
  });
});
