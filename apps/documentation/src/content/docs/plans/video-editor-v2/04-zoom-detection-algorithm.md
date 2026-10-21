---
title: "Video editor v2 — 04 zoom detection algorithm"
description: "The complete, deterministic zoom detector: click clusters and dwells, the sensitivity mapping, lead/hold/merge rules that realize the spec's hysteresis, the manual-wins replacement rule, Activity-track marks, and the owner's calibration recording. Fixes audit W8."
sidebar:
  order: 4
---

# 04 — Zoom detection algorithm

> **Status: 🟡 In progress** (2026-09-22). Part of PR 4 ("Zoom + source-time pure modules")
> in the [audit](/plans/video-editor-v2/00-audit/). Fixes W8. Pure TypeScript, no UI.
> Implemented on `feat/video-editor-v2-zoom-math` — not merged, not validated in
> production; see the [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## Problem

The overview says `detectZoomSegments(track, sensitivity)` with "hysteresis enter/exit
thresholds derived from sensitivity" and "calibration constants in one object". It
defines neither a dwell, a click cluster, how sensitivity maps to thresholds, where a
segment starts and ends, nor what happens to segments the user already edited. An
implementer would invent an algorithm — and every Sensitivity drag would then silently
overwrite user edits.

## The algorithm

Input: a `CursorTrack` (video/source ms, see [02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/)),
the recording duration, a sensitivity 0–100. Output: sorted, non-overlapping
`ZoomSegment[]` in **source seconds**, all `origin: "auto"`. Deterministic, including ids.

```
clicks ──► clusterClicks ──► keep if count ≥ minClusterScore(s) ──► [first − 400 ms, last + 2000 ms]  (click)
samples ─► findDwells(r = 1.5 % diag, min = minDwellMs(s)) ─► drop if touching first/last 1 s
                                                           └─► [start − 300 ms, min(end, start + 8 s) + 800 ms]  (dwell)
all candidates ─► clamp to [0, duration], stretch to ≥ 1 s ─► merge if gap ≤ 1200 ms ─► segments
```

**Distances** are measured in display pixels and expressed as a fraction of the display
diagonal, so a 1.5 % dwell radius means the same thing on a laptop and a 4K panel.

**Click cluster.** Clicks sorted by time; a click joins the current cluster when it is at
most 1500 ms after the cluster's last click **and** within 12 % of the diagonal of the
cluster's running centroid. Off-display clicks are ignored. Score = number of clicks.

**Dwell.** From sample `i`, extend `j` while sample `j` stays within the radius of sample
`i`. The dwell runs from `t[i]` to `t[j−1]` — which is exactly "until the pointer moved",
because the sample buffer keeps the last duplicate before a move. A run that reaches the
end of the track lasts until the recording's duration. Dwells touching the first or last
second are the user reaching for Record/Stop and never open a zoom.

**Sensitivity mapping** (single slider, spec § 7.4 "Lower keeps only the strongest
clicks. Higher also picks up long pauses."):

| Sensitivity | Min clicks per cluster | Dwells                    |
| ----------- | ---------------------- | ------------------------- |
| 0 – 24      | 3                      | off                       |
| 25 – 39     | 2                      | off                       |
| 40 – 49     | 2                      | ≥ 2500 ms … (linear)      |
| 50 – 100    | 1                      | … down to ≥ 900 ms at 100 |

Default sensitivity: **55** (single clicks + dwells ≥ 2.1 s — `minDwellMs(55) === 2100`).
Values outside 0–100 are clamped, so a corrupted session or a stray slider value cannot
silently turn detection off.

**Hysteresis**, as the spec demands, is asymmetric edges rather than two thresholds on a
signal: a segment opens only on a qualifying event, but closes only after 2000 ms (click)
or 800 ms (dwell) of quiet, and two segments closer than 1200 ms fuse. The zoom therefore
never flickers out and back in.

**Segment defaults.** Click segments: scale 2.0; dwell-only segments: scale 1.6; both
`mode: "follow"`, `anchor: null`, `smoothing: 70`, `trigger` = `"click"` if any merged
candidate was a click, else `"dwell"`. Id = `auto-<start ms>` (unique because segments do
not overlap; stable across runs so tests and React keys are stable).

**Replacement rule** (Sensitivity and Re-analyse): drop every `auto` segment, keep every
`manual` segment, add each new auto segment that does not overlap a manual one **and does
not reuse a manual segment's id**. **Any user edit of an auto segment** (edge drag, level,
smoothing, mode, box drag) **sets `origin: "manual"`** — that is how "your manual edits
are kept" (spec § 7.4) holds. An edit flips `origin`, never the id, so an edited segment
keeps its `auto-<startMs>` name; a later run can mint that same name for a segment that
does not overlap it, and two segments sharing an id break React keys, the selection model
and `dragZoomEdge`. Hence the id check. The inspector badge still reads from `trigger`, so
an edited click zoom still shows `CLICK DETECTED`.

**Performance (measured).** 1 h track, 225 k samples, 350 segments: 28 ms. Running it on
every Sensitivity `input` event is fine. That figure assumes real tracks: `findDwells`
rescans a run it rejected (it restarts one sample later), which is O(n · runLength) rather
than O(n), and on a real track a sub-threshold run is a handful of samples because the
buffer stores a sample only when the pointer **moves**. A synthetic track drifting just
under the radius for minutes is the quadratic worst case; the code says so.

## Files

| Action       | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/zoom/`) |
| ------------ | ----------------------------------------------------------------------------- |
| Create       | `zoom-model.ts`                                                               |
| Create       | `detect-zoom-segments.ts` + `.test.ts`                                        |
| Owner, later | `__fixtures__/demo.cursor.json` + `detect-zoom-segments.fixture.test.ts`      |

`@shared/cursor-track` comes from PR 2. The fixture pair is **not** part of this PR — see
[Verify (owner, manual)](#verify-owner-manual).

## Tasks

### Task 1 — zoom model

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/zoom-model.ts`**

```ts
/**
 * Zoom + privacy data carried by the video scene (see scene.ts). Every time here is
 * SOURCE seconds (position in the original recording), NOT timeline seconds — these
 * describe the content, so a cut earlier in the timeline must not shift them. The
 * timeline UI maps them through `sourceRangeToTimelineBlocks` (source-time.ts).
 */

export type ZoomMode = "follow" | "fixed";

export interface ZoomSegment {
  id: string;
  /** Source seconds, inclusive. */
  start: number;
  /** Source seconds, exclusive; end - start >= ZOOM_LIMITS.minSeconds. */
  end: number;
  /** Magnification, ZOOM_LIMITS.minScale–maxScale. */
  scale: number;
  mode: ZoomMode;
  /** Normalized camera CENTER for "fixed"; null for "follow". */
  anchor: { x: number; y: number } | null;
  /** 0 = snappy, 100 = floaty. */
  smoothing: number;
  /** "auto" segments are replaced when detection re-runs; any user edit flips to "manual". */
  origin: "auto" | "manual";
  /** What produced an auto segment (inspector badge); null for hand-made ones. */
  trigger: "click" | "dwell" | null;
}

export const ZOOM_LIMITS = {
  minScale: 1,
  maxScale: 4,
  minSeconds: 1,
  /** Length of a zoom added by hand at the playhead. */
  manualSeconds: 3,
} as const;

/**
 * Defaults shared by the detector, the camera and the scene. They live in this module —
 * the smallest one, with no imports at all — so `scene.ts` can read them without
 * value-importing the detector (which would drag it into the export worker bundle).
 */
export const ZOOM_DEFAULTS = {
  /** Detection sensitivity of a fresh scene, 0–100. */
  sensitivity: 55,
  /** Camera smoothing of a new segment: 0 = snappy, 100 = floaty. */
  smoothing: 70,
} as const;
```

`anchor` is `… | null` rather than optional (the specs' `anchor?`): parsing and equality
stay total, and JSON round-trips without dropping the key.

`ZOOM_LIMITS` and `ZOOM_DEFAULTS` are the **single source of truth** for the scale ceiling
and the two defaults: `CAMERA` ([05](/plans/video-editor-v2/05-camera-path-model/)),
`DETECTION` (below) and `initialScene` ([07](/plans/video-editor-v2/07-scene-session-and-history/))
all read them instead of repeating the numbers.

### Task 2 — detector

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/detect-zoom-segments.ts`**

```ts
/**
 * Offline zoom detection: cursor track → proposed zoom segments. Pure and
 * deterministic (same track + duration + sensitivity → same segments, same ids).
 *
 * Signals (never raw movement — a pointer crossing the screen is not intent):
 *   - click clusters: clicks close in time AND space; score = clicks in the cluster
 *   - dwells: the pointer stays within a small radius for long enough
 * Sensitivity (0–100) only moves thresholds: low keeps strong click clusters only,
 * high also accepts single clicks and shorter dwells.
 *
 * "Hysteresis" from the design spec is realized here as asymmetric edges: a segment
 * needs a qualifying event to open, but only closes after `*HoldMs` of quiet, and
 * segments closer than `mergeGapMs` fuse — so the zoom never flickers out and back.
 */
import { type CursorTrack, isOnDisplay } from "@shared/cursor-track";
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom-model";

export const DETECTION = {
  /** Dwell radius, as a fraction of the display diagonal. */
  dwellRadius: 0.015,
  /** Below this sensitivity dwells never open a zoom. */
  dwellSensitivityFloor: 40,
  /** Minimum dwell (ms) at the floor and at sensitivity 100 (linear in between). */
  dwellMinMsAtFloor: 2500,
  dwellMinMsAtMax: 900,
  /** Dwells shown on the Activity track (evidence), independent of sensitivity. */
  activityDwellMinMs: 600,
  /** Dwell length that draws a full-height Activity bar (strength 1). */
  activityDwellFullMs: 4000,
  /** Dwells touching the first/last this-many ms are the user reaching for Record/Stop. */
  edgeIgnoreMs: 1000,
  /** A dwell longer than this still zooms, but only for this long (+ hold). */
  dwellMaxZoomMs: 8000,
  clusterGapMs: 1500,
  /** Cluster radius, as a fraction of the display diagonal. */
  clusterRadius: 0.12,
  clickLeadMs: 400,
  clickHoldMs: 2000,
  dwellLeadMs: 300,
  dwellHoldMs: 800,
  mergeGapMs: 1200,
  clickScale: 2,
  dwellScale: 1.6,
} as const;

/** Sensitivity is a raw UI number; a stray value must not silently disable detection. */
function clampSensitivity(sensitivity: number): number {
  return Math.min(100, Math.max(0, sensitivity));
}

/** Minimum clicks a cluster needs to open a zoom at this sensitivity. */
export function minClusterScore(sensitivity: number): number {
  const s = clampSensitivity(sensitivity);
  if (s < 25) return 3;
  if (s < 50) return 2;
  return 1;
}

/** Minimum dwell length (ms) at this sensitivity, or null when dwells are off. */
export function minDwellMs(sensitivity: number): number | null {
  const s = clampSensitivity(sensitivity);
  if (s < DETECTION.dwellSensitivityFloor) return null;
  const k = (s - DETECTION.dwellSensitivityFloor) / (100 - DETECTION.dwellSensitivityFloor);
  return Math.round(
    DETECTION.dwellMinMsAtFloor + (DETECTION.dwellMinMsAtMax - DETECTION.dwellMinMsAtFloor) * k,
  );
}

export interface Dwell {
  /** Video/source ms. */
  start: number;
  end: number;
  x: number;
  y: number;
}

export interface ClickCluster {
  start: number;
  end: number;
  x: number;
  y: number;
  count: number;
}

/** Distance between two normalized points as a fraction of the display diagonal. */
function diagDistance(track: CursorTrack, ax: number, ay: number, bx: number, by: number): number {
  const { width: w, height: h } = track.display;
  return Math.hypot((ax - bx) * w, (ay - by) * h) / Math.hypot(w, h);
}

/**
 * Pointer pauses: runs of samples within `radius` (diagonal fraction) of the run's
 * first sample lasting at least `minMs`. Relies on CursorSampleBuffer keeping the last
 * duplicate before a move, so an idle stretch is [first sample, last duplicate].
 * A run that reaches the end of the track lasts until `durationMs`.
 */
export function findDwells(
  track: CursorTrack,
  radius: number,
  minMs: number,
  durationMs: number,
): Dwell[] {
  const { t, x, y } = track;
  const n = t.length;
  const out: Dwell[] = [];
  let i = 0;
  while (i < n) {
    if (!isOnDisplay({ x: x[i], y: y[i] })) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && diagDistance(track, x[i], y[i], x[j], y[j]) <= radius) j++;
    const end = j < n ? t[j - 1] : Math.max(t[n - 1], durationMs);
    if (end - t[i] >= minMs) {
      out.push({ start: t[i], end, x: x[i], y: y[i] });
      i = j;
    } else {
      // Rejected: restart one sample later, so a long slow drift is rescanned and the
      // scan is O(n · runLength) rather than O(n). The 28 ms figure below assumes real
      // tracks, where a sub-threshold run is a handful of samples: the buffer stores a
      // sample only when the pointer MOVES (plus the last duplicate before a move), so
      // a stationary pointer produces two samples, not hundreds. A synthetic track that
      // drifts just under `radius` for minutes is the quadratic worst case.
      i++;
    }
  }
  return out;
}

/** Groups on-display clicks that are close in time (to the previous click) and space (to the centroid). */
export function clusterClicks(track: CursorTrack): ClickCluster[] {
  const out: ClickCluster[] = [];
  let cur: ClickCluster | null = null;
  for (const c of track.clicks) {
    if (!isOnDisplay(c)) continue;
    if (
      cur &&
      c.t - cur.end <= DETECTION.clusterGapMs &&
      diagDistance(track, c.x, c.y, cur.x, cur.y) <= DETECTION.clusterRadius
    ) {
      const count: number = cur.count + 1;
      cur = {
        start: cur.start,
        end: c.t,
        x: cur.x + (c.x - cur.x) / count,
        y: cur.y + (c.y - cur.y) / count,
        count,
      };
      out[out.length - 1] = cur;
    } else {
      cur = { start: c.t, end: c.t, x: c.x, y: c.y, count: 1 };
      out.push(cur);
    }
  }
  return out;
}

interface Candidate {
  start: number;
  end: number;
  trigger: "click" | "dwell";
}

function withMinDuration(c: Candidate, durationMs: number): Candidate {
  const minMs = ZOOM_LIMITS.minSeconds * 1000;
  let start = Math.max(0, c.start);
  let end = Math.min(durationMs, c.end);
  if (end - start < minMs) {
    end = Math.min(durationMs, start + minMs);
    start = Math.max(0, end - minMs);
  }
  return { ...c, start, end };
}

function merge(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const out: Candidate[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start - last.end <= DETECTION.mergeGapMs) {
      last.end = Math.max(last.end, c.end);
      if (c.trigger === "click") last.trigger = "click";
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

export function detectZoomSegments(
  track: CursorTrack,
  durationSeconds: number,
  sensitivity: number,
): ZoomSegment[] {
  const durationMs = durationSeconds * 1000;
  if (durationMs < ZOOM_LIMITS.minSeconds * 1000) return [];
  const s = clampSensitivity(sensitivity);
  const candidates: Candidate[] = [];

  if (track.clicksAvailable) {
    const minScore = minClusterScore(s);
    for (const cluster of clusterClicks(track)) {
      if (cluster.count < minScore) continue;
      candidates.push({
        start: cluster.start - DETECTION.clickLeadMs,
        end: cluster.end + DETECTION.clickHoldMs,
        trigger: "click",
      });
    }
  }

  const dwellMin = minDwellMs(s);
  if (dwellMin !== null) {
    for (const d of findDwells(track, DETECTION.dwellRadius, dwellMin, durationMs)) {
      if (d.start < DETECTION.edgeIgnoreMs) continue;
      if (d.end > durationMs - DETECTION.edgeIgnoreMs) continue;
      candidates.push({
        start: d.start - DETECTION.dwellLeadMs,
        end: Math.min(d.end, d.start + DETECTION.dwellMaxZoomMs) + DETECTION.dwellHoldMs,
        trigger: "dwell",
      });
    }
  }

  return merge(candidates.map((c) => withMinDuration(c, durationMs))).map((c) => ({
    id: `auto-${Math.round(c.start)}`,
    start: c.start / 1000,
    end: c.end / 1000,
    scale: c.trigger === "click" ? DETECTION.clickScale : DETECTION.dwellScale,
    mode: "follow",
    anchor: null,
    smoothing: ZOOM_DEFAULTS.smoothing,
    origin: "auto",
    trigger: c.trigger,
  }));
}

/**
 * Sensitivity / Re-analyse: drop every "auto" segment, keep every "manual" one, and add
 * the freshly detected segments that neither overlap a manual one nor reuse its id
 * (manual always wins).
 */
export function replaceAutoSegments(
  current: ZoomSegment[],
  detected: ZoomSegment[],
): ZoomSegment[] {
  const manual = current.filter((s) => s.origin === "manual");
  // A segment the user edited keeps the `auto-<startMs>` id it was born with — an edit
  // flips `origin`, never the id (see zoom-edits.ts). A later run can therefore mint
  // that same id for a segment that does NOT overlap it, and two segments with one id
  // break React keys, the selection model and `dragZoomEdge`'s sibling lookup.
  const taken = new Set(manual.map((m) => m.id));
  const kept = detected.filter(
    (d) => !taken.has(d.id) && !manual.some((m) => d.start < m.end && m.start < d.end),
  );
  return [...manual, ...kept].sort((a, b) => a.start - b.start);
}

export type ActivityMark =
  | { kind: "click"; t: number }
  | { kind: "dwell"; start: number; end: number; strength: number };

/**
 * Evidence for the Activity track, in SOURCE seconds. Dwell `strength` is 0–1
 * (`activityDwellMinMs` → 0, ≥ `activityDwellFullMs` → 1) and maps to the 6–18 px bar
 * height in the UI.
 */
export function activityMarks(track: CursorTrack, durationSeconds: number): ActivityMark[] {
  const marks: ActivityMark[] = [];
  if (track.clicksAvailable) {
    for (const c of track.clicks) if (isOnDisplay(c)) marks.push({ kind: "click", t: c.t / 1000 });
  }
  const span = DETECTION.activityDwellFullMs - DETECTION.activityDwellMinMs;
  for (const d of findDwells(
    track,
    DETECTION.dwellRadius,
    DETECTION.activityDwellMinMs,
    durationSeconds * 1000,
  )) {
    const strength = Math.max(
      0,
      Math.min(1, (d.end - d.start - DETECTION.activityDwellMinMs) / span),
    );
    marks.push({ kind: "dwell", start: d.start / 1000, end: d.end / 1000, strength });
  }
  return marks;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/detect-zoom-segments.test.ts`**

```ts
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
```

## Verify (owner, manual)

**Out of scope for the implementer agent.** This section needs a real 60 s recording on
real hardware; an agent cannot produce one, and a fixture test committed without its
fixture breaks `bun run test`. The agent finishes at Task 2 and does **not** create
`__fixtures__/demo.cursor.json` or `detect-zoom-segments.fixture.test.ts`.

A real recording pins the constants against reality instead of against themselves. The
owner does this once, after PR 2 (and PR 3, if merged) is installed:

- [ ] Record **exactly this script** on a screen source, 60 s, default quality:
  1. 0–5 s: keep the pointer still.
  2. 5–15 s: open a menu, click 3 items in a row (one cluster).
  3. 15–25 s: move around without clicking.
  4. 25–30 s: rest the pointer on one word for ~4 s (a dwell).
  5. 30–45 s: click two buttons far apart, ~5 s between them.
  6. 45–60 s: move to the Stop button and stop.
- [ ] Copy `<vault>/.kaipu/<id>.cursor.json` to `zoom/__fixtures__/demo.cursor.json`.
      Check it contains no private data (it only holds numbers).
- [ ] Add `detect-zoom-segments.fixture.test.ts` **in the same commit as the fixture**:

  ```ts
  import { describe, expect, it } from "vitest";
  import { parseCursorTrack } from "@shared/cursor-track";
  import demoJson from "./__fixtures__/demo.cursor.json?raw";
  import { detectZoomSegments } from "./detect-zoom-segments";

  // Recorded with the script in plans/video-editor-v2/04 § Verify. Ranges, not exact
  // counts: the script is performed by a human.
  const track = parseCursorTrack(demoJson)!;
  const duration = track.t[track.t.length - 1] / 1000;

  describe("detectZoomSegments on the demo recording", () => {
    it("parses", () => {
      expect(track).not.toBeNull();
    });
    it("proposes nothing at sensitivity 0 unless there was a 3-click cluster", () => {
      const n = detectZoomSegments(track, duration, 0).length;
      expect(n).toBeLessThanOrEqual(track.clicksAvailable ? 1 : 0);
    });
    it("proposes a handful of zooms at the default sensitivity", () => {
      const n = detectZoomSegments(track, duration, 55).length;
      expect(n).toBeGreaterThanOrEqual(track.clicksAvailable ? 3 : 1);
      expect(n).toBeLessThanOrEqual(6);
    });
    it("finds at least as many zooms at full sensitivity as at zero", () => {
      const low = detectZoomSegments(track, duration, 0).length;
      const high = detectZoomSegments(track, duration, 100).length;
      expect(high).toBeGreaterThanOrEqual(low);
    });
    it("never zooms in the first or last second because of a dwell", () => {
      for (const s of detectZoomSegments(track, duration, 100)) {
        if (s.trigger === "dwell") {
          expect(s.start).toBeGreaterThanOrEqual(0.7);
          expect(s.end).toBeLessThanOrEqual(duration);
        }
      }
    });
  });
  ```

  Segment **count is not monotonic in sensitivity** and the test must not assume it is:
  `findDwells` advances `i = j` when it accepts a run, so a smaller `minMs` can consume
  samples a larger one skips, and `merge` can fuse several candidates into one. A
  concrete counterexample at radius 0.015, samples drifting 0.008/s over 0–5 s of a 10 s
  track: `minMs` 800 yields 3 dwells covering 8 s, `minMs` 1500 yields 1 dwell covering
  6 s. Only the two endpoints are compared above, and even that is an observation about
  this recording, not a property of the algorithm.

- [ ] If a range assertion fails on the real fixture, **do not change the constants**.
      Stop and report the counts per sensitivity; tuning is an owner decision.

## Acceptance criteria

- `detect-zoom-segments.test.ts` passes unchanged. The fixture test is **not** part of
  this PR: the owner adds it, together with its recording, after the calibration run
  described in [Verify](#verify-owner-manual).
- The detector has no dependency on React, DOM or Electron.
- `zoom-model.ts` imports nothing, so `scene.ts` can read `ZOOM_DEFAULTS` from it without
  pulling the detector into the export worker bundle.

## Non-goals

Keyboard/scroll signals, per-app heuristics, machine-learned detection, detecting the
cursor from pixels (pipeline spec § 4: only as a future fallback for imported videos).

## Reopen if

Owner review of real recordings shows systematic misses (e.g. drag-and-drop, which
produces one click and long motion) — add a "drag" candidate type, keep this structure.
