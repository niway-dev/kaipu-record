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
  let flatViolation = false;
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
      flatViolation = true;
      longestStallMs = Math.max(longestStallMs, spanMs);
    }
  }
  const violated = flatViolation || longestStallMs > opts.maxStallMs;

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

export interface FileTick {
  tMs: number;
  /** Bytes per watched file at this tick. Keys stay in memory; they are never written. */
  files: Map<string, number>;
}

/**
 * Judges each file on its own, so an idle or unrelated file never produces a VIOLATED.
 * A file already present at the first tick is judged only from its first increase and is
 * ignored if it never changes (a stale leftover). A file that appears later is judged
 * from its first sample, so a new export stuck at 28 bytes still fails.
 */
export function checkOutputGrowthPerFile(
  ticks: FileTick[],
  opts: { maxStallMs: number },
): OutputGrowthResult {
  const keys = new Set<string>();
  for (const t of ticks) for (const k of t.files.keys()) keys.add(k);
  const first = ticks[0]?.files ?? new Map<string, number>();
  const results: OutputGrowthResult[] = [];
  let ignoredIdle = 0;
  for (const key of keys) {
    let series: OutputSample[] = ticks.map((t) => ({
      tMs: t.tMs,
      bytes: t.files.get(key) ?? null,
    }));
    if (first.has(key)) {
      const grew = series.findIndex(
        (s, i) =>
          i > 0 &&
          s.bytes !== null &&
          series[i - 1]!.bytes !== null &&
          s.bytes > (series[i - 1]!.bytes as number),
      );
      if (grew < 0) {
        ignoredIdle++;
        continue;
      }
      series = series.slice(grew - 1);
    }
    results.push(checkOutputGrowth(series, opts));
  }
  if (results.length === 0) {
    return {
      held: null,
      maxStallMs: opts.maxStallMs,
      longestStallMs: 0,
      segments: 0,
      growthEvents: 0,
      firstBytes: null,
      lastBytes: null,
      reason:
        ignoredIdle > 0
          ? "only files that were already there and never changed (idle) were seen"
          : "the output file never appeared",
    };
  }
  const bad = results.find((r) => r.held === false);
  const verdict = bad ? false : results.some((r) => r.held === true) ? true : null;
  const pick = bad ?? results.find((r) => r.held === verdict) ?? results[0]!;
  return {
    held: verdict,
    reason: pick.reason,
    maxStallMs: opts.maxStallMs,
    longestStallMs: Math.max(...results.map((r) => r.longestStallMs)),
    segments: results.reduce((n, r) => n + r.segments, 0),
    growthEvents: results.reduce((n, r) => n + r.growthEvents, 0),
    firstBytes: results[0]!.firstBytes,
    lastBytes: results[results.length - 1]!.lastBytes,
  };
}
