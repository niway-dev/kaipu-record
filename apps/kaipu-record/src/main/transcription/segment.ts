/**
 * Fixed-window segmentation (measured in the M0 spike: 30 s windows, 3 s overlap). A segment is a
 * time range of the PCM file; neighbours overlap, so every word lies whole in at least one
 * segment. For each overlapping pair one cut point is chosen at the quietest 100 ms inside the
 * middle 60% of the overlap, and `reconcile` (words.ts) uses it to decide which side keeps a word.
 */

export type Segment = { id: string; startMs: number; endMs: number };
export type Seam = {
  beforeId: string;
  afterId: string;
  /** Integer ms, inside the middle 60% of the overlap. */
  cutMs: number;
  overlapStartMs: number;
  overlapEndMs: number;
};
export type SegmentPlan = { segments: Segment[]; seams: Seam[] };

export const DEFAULT_WINDOW_MS = 30_000;
export const DEFAULT_OVERLAP_MS = 3_000;
/** Frame length of the level array `planSegments` and `voicedMs` expect. */
export const LEVEL_FRAME_MS = 20;
/** Frames louder than (noise floor + this margin) count as speech. */
export const DEFAULT_SPEECH_MARGIN_DB = 12;

export function planSegments(input: {
  durationMs: number;
  levels: Float32Array;
  windowMs?: number;
  overlapMs?: number;
  frameMs?: number;
}): SegmentPlan {
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const overlapMs = input.overlapMs ?? DEFAULT_OVERLAP_MS;
  const frameMs = input.frameMs ?? LEVEL_FRAME_MS;
  if (!(windowMs > 0) || overlapMs < 0 || overlapMs >= windowMs) {
    throw new Error(`invalid windows: windowMs=${windowMs} overlapMs=${overlapMs}`);
  }
  const durationMs = Math.round(input.durationMs);
  const segments: Segment[] = [];
  let cursor = 0;
  while (cursor < durationMs) {
    const end = Math.min(durationMs, cursor + windowMs);
    segments.push({ id: `s${segments.length}`, startMs: cursor, endMs: end });
    if (end >= durationMs) break;
    cursor = end - overlapMs;
  }
  return { segments, seams: deriveSeams(segments, input.levels, frameMs) };
}

/** One seam per pair of consecutive segments that overlap in time. */
function deriveSeams(segments: Segment[], levels: Float32Array, frameMs: number): Seam[] {
  const seams: Seam[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    const overlapStartMs = b.startMs;
    const overlapEndMs = a.endMs;
    if (overlapEndMs <= overlapStartMs) continue;
    const span = overlapEndMs - overlapStartMs;
    const from = overlapStartMs + span * 0.2;
    const to = overlapEndMs - span * 0.2;
    const cutMs =
      span < 200
        ? Math.round((overlapStartMs + overlapEndMs) / 2)
        : quietestCut(levels, from, to, frameMs);
    seams.push({
      beforeId: a.id,
      afterId: b.id,
      cutMs: Math.min(Math.max(cutMs, Math.ceil(from)), Math.floor(to)),
      overlapStartMs,
      overlapEndMs,
    });
  }
  return seams;
}

/** Centre (ms) of the quietest 100 ms window whose centre lies inside [fromMs, toMs]. */
function quietestCut(levels: Float32Array, fromMs: number, toMs: number, frameMs: number): number {
  const half = Math.max(1, Math.round(50 / frameMs));
  const lo = Math.max(half, Math.floor(fromMs / frameMs));
  const hi = Math.min(levels.length - half - 1, Math.floor(toMs / frameMs));
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
  return Math.round(best * frameMs + frameMs / 2);
}

/**
 * The level above which a frame counts as speech: the 10th percentile of the whole file (its
 * noise floor) plus a margin. Compute it once per file and pass it to `voicedMs`.
 */
export function speechThresholdDb(
  levels: Float32Array,
  marginDb = DEFAULT_SPEECH_MARGIN_DB,
): number {
  if (levels.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = Float32Array.from(levels).sort();
  return sorted[Math.floor(sorted.length * 0.1)]! + marginDb;
}

/** Milliseconds of frames wholly inside the segment whose level is above `thresholdDb`. */
export function voicedMs(
  levels: Float32Array,
  segment: Segment,
  thresholdDb: number,
  frameMs = LEVEL_FRAME_MS,
): number {
  const first = Math.ceil(segment.startMs / frameMs);
  const last = Math.min(Math.floor(segment.endMs / frameMs), levels.length);
  let voiced = 0;
  for (let f = first; f < last; f++) if (levels[f]! > thresholdDb) voiced++;
  return voiced * frameMs;
}
