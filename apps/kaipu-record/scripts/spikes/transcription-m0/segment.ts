/**
 * Segmentation strategies under test. A segment is a time range of the PCM file; segments may
 * overlap. `seam` records, for each pair of overlapping neighbours, the overlap range and the
 * cut point chosen inside it (the quietest frame), which `reconcile.ts` uses.
 */
import { SAMPLE_RATE, frameLevelsDb } from "./audio";

export type Segment = { id: number; startMs: number; endMs: number };
export type Seam = {
  beforeId: number;
  afterId: number;
  cutMs: number;
  overlapStartMs: number;
  overlapEndMs: number;
};
export type Plan = { segments: Segment[]; seams: Seam[] };

const FRAME_MS = 20;

export type EnergyOptions = {
  /** Frames louder than (noise floor + marginDb) are speech. */
  marginDb: number;
  /** Gaps shorter than this inside speech do not split it. */
  mergeGapMs: number;
  /** Speech shorter than this is dropped as a click or a key press. */
  minSpeechMs: number;
  padMs: number;
  maxSegmentMs: number;
  overlapMs: number;
};

export const ENERGY_DEFAULTS: EnergyOptions = {
  marginDb: 12,
  mergeGapMs: 400,
  minSpeechMs: 160,
  padMs: 300,
  maxSegmentMs: 25_000,
  overlapMs: 2_000,
};

export type FixedOptions = { windowMs: number; overlapMs: number };
export const FIXED_DEFAULTS: FixedOptions = { windowMs: 30_000, overlapMs: 3_000 };

/** One seam per pair of consecutive segments that overlap in time. */
export function deriveSeams(segments: Segment[], levels: Float32Array): Seam[] {
  const seams: Seam[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    const overlapStartMs = b.startMs;
    const overlapEndMs = a.endMs;
    if (overlapEndMs <= overlapStartMs) continue;
    const span = overlapEndMs - overlapStartMs;
    const cutMs =
      span < 200
        ? (overlapStartMs + overlapEndMs) / 2
        : quietestCut(levels, overlapStartMs + span * 0.2, overlapEndMs - span * 0.2);
    seams.push({ beforeId: a.id, afterId: b.id, cutMs, overlapStartMs, overlapEndMs });
  }
  return seams;
}

/** The quietest 100 ms window whose centre lies inside [fromMs, toMs]. */
export function quietestCut(levels: Float32Array, fromMs: number, toMs: number): number {
  const half = Math.round(50 / FRAME_MS);
  const lo = Math.max(half, Math.floor(fromMs / FRAME_MS));
  const hi = Math.min(levels.length - half - 1, Math.floor(toMs / FRAME_MS));
  let best = lo;
  let bestScore = Infinity;
  for (let f = lo; f <= hi; f++) {
    let score = 0;
    for (let k = -half; k <= half; k++) score += levels[f + k]!;
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best * FRAME_MS + FRAME_MS / 2;
}

function noiseFloorDb(levels: Float32Array): number {
  const sorted = Float32Array.from(levels).sort();
  return sorted[Math.floor(sorted.length * 0.1)]!;
}

/** Speech regions [startMs, endMs) from frame energy, before padding. */
export function speechRegions(samples: Int16Array, o: EnergyOptions): [number, number][] {
  const levels = frameLevelsDb(samples, FRAME_MS);
  const threshold = noiseFloorDb(levels) + o.marginDb;
  const regions: [number, number][] = [];
  let start = -1;
  for (let f = 0; f <= levels.length; f++) {
    const loud = f < levels.length && levels[f]! > threshold;
    if (loud && start < 0) start = f;
    if (!loud && start >= 0) {
      regions.push([start * FRAME_MS, f * FRAME_MS]);
      start = -1;
    }
  }
  const merged: [number, number][] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= o.mergeGapMs) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([s, e]) => e - s >= o.minSpeechMs);
}

export function planEnergy(samples: Int16Array, o: EnergyOptions = ENERGY_DEFAULTS): Plan {
  const durationMs = (samples.length / SAMPLE_RATE) * 1000;
  const levels = frameLevelsDb(samples, FRAME_MS);
  const segments: Segment[] = [];
  let id = 0;
  for (const [s, e] of speechRegions(samples, o)) {
    const start = Math.max(0, s - o.padMs);
    const end = Math.min(durationMs, e + o.padMs);
    if (end - start <= o.maxSegmentMs) {
      segments.push({ id: id++, startMs: start, endMs: end });
      continue;
    }
    // A long region: windows of maxSegmentMs, each overlapping the next by overlapMs.
    let cursor = start;
    while (cursor < end) {
      const windowEnd = Math.min(end, cursor + o.maxSegmentMs);
      segments.push({ id: id++, startMs: cursor, endMs: windowEnd });
      if (windowEnd >= end) break;
      const overlapStart = windowEnd - o.overlapMs;
      cursor = overlapStart;
    }
  }
  return { segments, seams: deriveSeams(segments, levels) };
}

export function planFixed(samples: Int16Array, o: FixedOptions = FIXED_DEFAULTS): Plan {
  const durationMs = (samples.length / SAMPLE_RATE) * 1000;
  const levels = frameLevelsDb(samples, FRAME_MS);
  const segments: Segment[] = [];
  let cursor = 0;
  let id = 0;
  while (cursor < durationMs) {
    const end = Math.min(durationMs, cursor + o.windowMs);
    segments.push({ id: id++, startMs: cursor, endMs: end });
    if (end >= durationMs) break;
    const overlapStart = end - o.overlapMs;
    cursor = overlapStart;
  }
  return { segments, seams: deriveSeams(segments, levels) };
}
