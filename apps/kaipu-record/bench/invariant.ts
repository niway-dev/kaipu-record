export interface OutputSample {
  tMs: number;
  /** Total bytes of the watched files; null while no file exists. */
  bytes: number | null;
}

export interface OutputGrowthResult {
  /** true: held. false: violated. null: not enough data to judge. */
  held: boolean | null;
  reason: string;
  maxStallMs: number;
  longestStallMs: number;
  segments: number;
  growthEvents: number;
  firstBytes: number | null;
  lastBytes: number | null;
}

/**
 * "The output grows while exporting": while the file exists, its size on disk keeps
 * increasing. `longestStallMs` is the longest time between two increases (or between
 * the first sample and the first increase), so steady growth reports one sample
 * interval. Only gaps that end in an increase count. The flat tail after the last
 * increase is not a stall: a finished export stays flat until the file is renamed.
 * A segment is a run of samples while the file exists; it ends when the file
 * disappears or shrinks (a new export reused the folder).
 */
export function checkOutputGrowth(
  samples: OutputSample[],
  opts: { maxStallMs: number },
): OutputGrowthResult {
  const segments: OutputSample[][] = [];
  let cur: OutputSample[] = [];
  for (const s of samples) {
    if (s.bytes === null) {
      if (cur.length > 0) segments.push(cur);
      cur = [];
      continue;
    }
    const prev = cur[cur.length - 1];
    if (prev && s.bytes < (prev.bytes as number)) {
      segments.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length > 0) segments.push(cur);

  const existed = segments.flat();
  const base = {
    maxStallMs: opts.maxStallMs,
    segments: segments.length,
    firstBytes: existed[0]?.bytes ?? null,
    lastBytes: existed[existed.length - 1]?.bytes ?? null,
  };
  if (existed.length === 0) {
    return {
      ...base,
      held: null,
      reason: "the output file never appeared",
      longestStallMs: 0,
      growthEvents: 0,
    };
  }

  let longestStallMs = 0;
  let growthEvents = 0;
  let judged = false;
  let violated = false;
  for (const seg of segments) {
    let lastGrowthT = seg[0]!.tMs;
    let sawGrowth = false;
    for (let i = 1; i < seg.length; i++) {
      if ((seg[i]!.bytes as number) > (seg[i - 1]!.bytes as number)) {
        growthEvents++;
        longestStallMs = Math.max(longestStallMs, seg[i]!.tMs - lastGrowthT);
        lastGrowthT = seg[i]!.tMs;
        sawGrowth = true;
      }
    }
    const spanMs = seg[seg.length - 1]!.tMs - seg[0]!.tMs;
    if (seg.length >= 2) judged = judged || sawGrowth || spanMs >= opts.maxStallMs;
    if (!sawGrowth && spanMs >= opts.maxStallMs) {
      longestStallMs = Math.max(longestStallMs, spanMs);
    }
  }
  violated = longestStallMs > opts.maxStallMs;

  if (violated) {
    return {
      ...base,
      held: false,
      longestStallMs,
      growthEvents,
      reason: `the output file was stuck for ${Math.round(longestStallMs / 1000)} s (limit ${Math.round(opts.maxStallMs / 1000)} s) while it existed`,
    };
  }
  if (!judged) {
    return {
      ...base,
      held: null,
      longestStallMs,
      growthEvents,
      reason: "the output file was seen too briefly to judge",
    };
  }
  return {
    ...base,
    held: true,
    longestStallMs,
    growthEvents,
    reason: "the output file kept growing while it existed",
  };
}
