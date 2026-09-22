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
