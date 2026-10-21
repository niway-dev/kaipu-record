import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import {
  activityMarks,
  clusterClicks,
  detectZoomSegments,
  findDwells,
  minClusterScore,
  minDwellMs,
  replaceAutoSegments,
} from "./detect-zoom-segments";
import type { ZoomSegment } from "./zoom-model";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

function track(partial: Partial<CursorTrack> = {}): CursorTrack {
  return {
    version: 1,
    display: DISPLAY,
    anchor: "exact",
    clicksAvailable: true,
    t: [],
    x: [],
    y: [],
    clicks: [],
    ...partial,
  };
}

/** Pointer idle at (x, y) during [from, to] ms, as CursorSampleBuffer would store it. */
function idle(from: number, to: number, x: number, y: number) {
  return { t: [from, to], x: [x, x], y: [y, y] };
}

function concat(...parts: { t: number[]; x: number[]; y: number[] }[]) {
  return {
    t: parts.flatMap((p) => p.t),
    x: parts.flatMap((p) => p.x),
    y: parts.flatMap((p) => p.y),
  };
}

function seg(partial: Partial<ZoomSegment>): ZoomSegment {
  return {
    id: "s",
    start: 0,
    end: 1,
    scale: 2,
    mode: "follow",
    anchor: null,
    smoothing: 70,
    origin: "auto",
    trigger: "click",
    ...partial,
  };
}

describe("thresholds", () => {
  it("minClusterScore steps down with sensitivity", () => {
    expect(minClusterScore(0)).toBe(3);
    expect(minClusterScore(30)).toBe(2);
    expect(minClusterScore(55)).toBe(1);
  });
  it("minDwellMs is off below 40 and shrinks towards 900 ms", () => {
    expect(minDwellMs(39)).toBeNull();
    expect(minDwellMs(40)).toBe(2500);
    expect(minDwellMs(55)).toBe(2100);
    expect(minDwellMs(100)).toBe(900);
    expect(minDwellMs(70)).toBe(1700);
  });
  it("clamps a sensitivity outside 0–100", () => {
    expect(minClusterScore(-40)).toBe(3);
    expect(minClusterScore(1000)).toBe(1);
    expect(minDwellMs(-40)).toBeNull();
    expect(minDwellMs(1000)).toBe(900);
  });
});

describe("findDwells", () => {
  it("measures an idle stretch from first sample to last duplicate", () => {
    const tr = track(
      concat(idle(0, 100, 0.1, 0.1), idle(200, 3200, 0.5, 0.5), idle(3300, 3300, 0.9, 0.9)),
    );
    expect(findDwells(tr, 0.015, 1000, 3300)).toEqual([{ start: 200, end: 3200, x: 0.5, y: 0.5 }]);
  });
  it("extends a dwell that reaches the end of the track to the duration", () => {
    const tr = track(idle(1000, 1000, 0.5, 0.5));
    expect(findDwells(tr, 0.015, 1000, 5000)).toEqual([{ start: 1000, end: 5000, x: 0.5, y: 0.5 }]);
  });
  it("ignores samples off the captured display", () => {
    const tr = track(idle(0, 5000, 1.5, 0.5));
    expect(findDwells(tr, 0.015, 1000, 5000)).toEqual([]);
  });
});

describe("clusterClicks", () => {
  it("groups clicks close in time and space; splits far ones", () => {
    const tr = track({
      clicks: [
        { t: 1000, x: 0.5, y: 0.5, button: 0 },
        { t: 1800, x: 0.52, y: 0.5, button: 0 },
        { t: 2500, x: 0.9, y: 0.9, button: 0 }, // far in space
        { t: 9000, x: 0.9, y: 0.9, button: 0 }, // far in time
      ],
    });
    expect(clusterClicks(tr).map((c) => c.count)).toEqual([2, 1, 1]);
  });
});

describe("detectZoomSegments", () => {
  const clicks = track({
    ...idle(0, 20_000, 0.5, 0.5),
    clicks: [
      { t: 5000, x: 0.3, y: 0.3, button: 0 },
      { t: 12_000, x: 0.7, y: 0.7, button: 0 },
      { t: 12_500, x: 0.7, y: 0.7, button: 0 },
    ],
  });

  it("proposes one segment per qualifying cluster with lead and hold", () => {
    const segs = detectZoomSegments(clicks, 20, 55);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [4.6, 7],
      [11.6, 14.5],
    ]);
    expect(segs[0]).toMatchObject({ origin: "auto", trigger: "click", scale: 2, mode: "follow" });
  });
  it("keeps only strong clusters at low sensitivity", () => {
    expect(detectZoomSegments(clicks, 20, 30).map((s) => s.start)).toEqual([11.6]);
    expect(detectZoomSegments(clicks, 20, 10)).toEqual([]);
  });
  it("clamps a sensitivity outside 0–100 instead of losing every zoom", () => {
    expect(detectZoomSegments(clicks, 20, 1000)).toEqual(detectZoomSegments(clicks, 20, 100));
    expect(detectZoomSegments(clicks, 20, -50)).toEqual(detectZoomSegments(clicks, 20, 0));
  });
  it("merges candidates closer than mergeGapMs", () => {
    const tr = track({
      clicks: [
        { t: 5000, x: 0.3, y: 0.3, button: 0 },
        { t: 8000, x: 0.8, y: 0.8, button: 0 }, // 7000 hold end vs 7600 start → gap 600
      ],
    });
    const segs = detectZoomSegments(tr, 20, 55);
    expect(segs.map((s) => [s.start, s.end])).toEqual([[4.6, 10]]);
  });
  it("adds dwell segments only at high enough sensitivity, ignoring edges", () => {
    const tr = track({
      clicksAvailable: false,
      ...concat(idle(0, 500, 0.1, 0.1), idle(3000, 6000, 0.5, 0.5), idle(6100, 20_000, 0.9, 0.9)),
    });
    expect(detectZoomSegments(tr, 20, 30)).toEqual([]);
    const segs = detectZoomSegments(tr, 20, 55);
    // The 13.9 s idle to the end touches the last second → ignored; the first one isn't.
    expect(segs.map((s) => [s.start, s.end, s.trigger, s.scale])).toEqual([
      [2.7, 6.8, "dwell", 1.6],
    ]);
  });
  it("is deterministic (same ids for the same input)", () => {
    expect(detectZoomSegments(clicks, 20, 55)).toEqual(detectZoomSegments(clicks, 20, 55));
    expect(detectZoomSegments(clicks, 20, 55)[0].id).toBe("auto-4600");
  });
  it("clamps to the recording and enforces 1 s minimum", () => {
    const tr = track({ clicks: [{ t: 100, x: 0.5, y: 0.5, button: 0 }] });
    const [s] = detectZoomSegments(tr, 1.5, 55);
    expect(s.start).toBe(0);
    expect(s.end).toBe(1.5);
  });
});

describe("replaceAutoSegments", () => {
  it("drops old autos, keeps manuals, and drops new autos overlapping a manual", () => {
    const current = [
      seg({ id: "a", start: 0, end: 2, origin: "auto" }),
      seg({ id: "m", start: 5, end: 7, origin: "manual" }),
    ];
    const detected = [seg({ id: "n1", start: 1, end: 3 }), seg({ id: "n2", start: 6, end: 8 })];
    expect(replaceAutoSegments(current, detected).map((s) => s.id)).toEqual(["n1", "m"]);
  });
  it("never lets a new auto reuse the id of an edited segment", () => {
    // The user dragged `auto-4600` to 20–22 s; it kept its id when it flipped to manual.
    const current = [seg({ id: "auto-4600", start: 20, end: 22, origin: "manual" })];
    const detected = [seg({ id: "auto-4600", start: 4.6, end: 7 })];
    expect(replaceAutoSegments(current, detected).map((s) => s.id)).toEqual(["auto-4600"]);
    expect(replaceAutoSegments(current, detected)[0].origin).toBe("manual");
  });
});

describe("activityMarks", () => {
  it("returns clicks and dwells in seconds with 0–1 strength", () => {
    const tr = track({
      ...concat(idle(0, 600, 0.2, 0.2), idle(700, 4700, 0.5, 0.5), idle(4800, 4800, 0.9, 0.9)),
      clicks: [{ t: 1500, x: 0.5, y: 0.5, button: 0 }],
    });
    expect(activityMarks(tr, 4.8)).toEqual([
      { kind: "click", t: 1.5 },
      { kind: "dwell", start: 0, end: 0.6, strength: 0 },
      { kind: "dwell", start: 0.7, end: 4.7, strength: 1 },
    ]);
  });
});
