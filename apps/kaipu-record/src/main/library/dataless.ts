import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";

/**
 * Evicted ("online-only") files in a synced workspace (spec, Synced folders, "Evicted files").
 *
 * A File Provider placeholder keeps its size and attributes but holds no data, and any `read`,
 * `link()` or `copyFile()` makes the provider download it. `stat`, `lstat`, `access`, `readdir`
 * and xattr reads do not. Node's `fs.Stats` does not expose `st_flags`, so the flags come from
 * one `/usr/bin/stat -f '%f %N'` call per batch: a file is evicted when `SF_DATALESS` is set.
 * Zero blocks is only a fallback for when that call gives nothing: a sparse local file also has
 * zero blocks (the spike's false positive).
 */

/** `SF_DATALESS` from `<sys/stat.h>`: the file's data is not on this Mac. */
export const SF_DATALESS = 0x40000000;

/** How long one `stat` batch may take. Answered in milliseconds in the spike; never hangs here. */
export const STAT_TIMEOUT_MS = 5_000;

/** Paths per `stat` call: well under ARG_MAX for any vault path length. */
const BATCH = 200;

export interface DatalessDeps {
  /** Run `/usr/bin/stat -f '%f %N' <paths…>`; `failed` when it exited non-zero (any missing file). */
  runStat(paths: string[]): Promise<{ stdout: string; failed: boolean }>;
  lstat(path: string): Promise<{ size: number; blocks: number }>;
}

/** `<flags> <path>` per line, flags in decimal (`%f`). Paths may contain spaces. */
export function parseStatFlags(stdout: string): Map<string, number> {
  const flags = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const match = /^(\d+) (.+)$/.exec(line);
    if (match) flags.set(match[2]!, Number(match[1]));
  }
  return flags;
}

function runStatCli(paths: string[]): Promise<{ stdout: string; failed: boolean }> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/stat",
      ["-f", "%f %N", "--", ...paths],
      { timeout: STAT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve({ stdout: String(stdout ?? ""), failed: error !== null }),
    );
  });
}

export const defaultDatalessDeps: DatalessDeps = {
  runStat: runStatCli,
  lstat: async (path) => {
    const info = await lstat(path);
    return { size: info.size, blocks: info.blocks };
  },
};

/** The longest a whole probe (a Library listing) may take: a stalled provider never hangs it. */
export const PROBE_DEADLINE_MS = 10_000;

/** What a step that ran out of time resolves to. */
const TIMED_OUT = Symbol("timed-out");

/** `step`, or `TIMED_OUT` once `ms` pass (a rejection reads as `failed`). */
async function within<T>(step: Promise<T>, ms: number, failed: T): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  try {
    return await Promise.race([step.catch(() => failed), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which of `paths` are evicted. A missing path is not. Never reads a file's data; never throws.
 *
 * Bounded as a whole by `deadlineMs`, a hard bound: every `stat` call and every fallback
 * `lstat` waits at most for what is left of it. Once it passes, every path not yet answered is
 * reported evicted. That is the safe side: an item that is in fact local only draws a
 * placeholder for this listing, while the other answer could hand out a URL that downloads it.
 */
export async function datalessPaths(
  paths: readonly string[],
  deps: DatalessDeps = defaultDatalessDeps,
  options: { deadlineMs?: number; now?: () => number } = {},
): Promise<Set<string>> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? PROBE_DEADLINE_MS);
  const left = (): number => deadline - now();
  const evicted = new Set<string>();
  const giveUp = (from: number): Set<string> => {
    console.warn(`[dataless] probe deadline passed; ${paths.length - from} path(s) unanswered`);
    for (const path of paths.slice(from)) evicted.add(path);
    return evicted;
  };
  for (let start = 0; start < paths.length; start += BATCH) {
    const batch = paths.slice(start, start + BATCH);
    if (left() <= 0) return giveUp(start);
    const answer = await within(deps.runStat(batch), left(), { stdout: "", failed: true });
    if (answer === TIMED_OUT) return giveUp(start);
    const flags = parseStatFlags(answer.stdout);
    if (flags.size > 0) {
      // stat answered: its flags are the truth, and a path it did not print is missing.
      for (const [path, value] of flags) {
        if ((value & SF_DATALESS) !== 0) evicted.add(path);
      }
      continue;
    }
    // stat gave nothing at all (not there, killed by its timeout): the block count is a guess.
    for (let index = 0; index < batch.length; index++) {
      const path = batch[index]!;
      const info = left() <= 0 ? TIMED_OUT : await within(deps.lstat(path), left(), null);
      if (info === TIMED_OUT) return giveUp(start + index);
      if (info && info.blocks === 0 && info.size > 0) evicted.add(path);
    }
  }
  return evicted;
}

/** Asks which of these paths are evicted. */
export type EvictionProbe = (paths: string[]) => Promise<ReadonlySet<string>>;

export const probeDataless: EvictionProbe = (paths) => datalessPaths(paths);

/**
 * The `kaipu-media://` protocol's gate. A "local" answer is never reused: every read is
 * authorized by a check made for it, so a file the provider offloaded a moment ago is never
 * opened. To keep a grid of thumbnails to a few `stat` calls, the requests that arrive within
 * `windowMs` share one batched probe. An "evicted" answer is remembered for `ttlMs` (refusing
 * reads nothing); `forget()` drops it once a download ends.
 */
export class EvictionCache {
  private readonly evictedAt = new Map<string, number>();
  private pending: { paths: Set<string>; result: Promise<ReadonlySet<string>> } | null = null;

  constructor(
    private readonly probe: EvictionProbe,
    private readonly ttlMs: number = 2_000,
    private readonly now: () => number = Date.now,
    private readonly windowMs: number = 15,
  ) {}

  async isEvicted(path: string): Promise<boolean> {
    const at = this.evictedAt.get(path);
    if (at !== undefined && this.now() - at < this.ttlMs) return true;
    const evicted = (await this.batch(path)).has(path);
    if (evicted) {
      this.evictedAt.set(path, this.now());
      if (this.evictedAt.size > 2_000) this.evictedAt.delete(this.evictedAt.keys().next().value!);
    } else {
      this.evictedAt.delete(path);
    }
    return evicted;
  }

  forget(path: string): void {
    this.evictedAt.delete(path);
  }

  /** One probe for every path asked within the window. */
  private batch(path: string): Promise<ReadonlySet<string>> {
    if (this.pending) {
      this.pending.paths.add(path);
      return this.pending.result;
    }
    const paths = new Set([path]);
    const result = new Promise<void>((resolve) => setTimeout(resolve, this.windowMs)).then(() => {
      this.pending = null;
      return this.probe([...paths]);
    });
    this.pending = { paths, result };
    return result;
  }
}
