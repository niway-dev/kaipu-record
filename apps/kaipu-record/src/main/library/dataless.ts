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

/** Which of `paths` are evicted. A missing path is not. Never reads a file's data; never throws. */
export async function datalessPaths(
  paths: readonly string[],
  deps: DatalessDeps = defaultDatalessDeps,
): Promise<Set<string>> {
  const evicted = new Set<string>();
  for (let start = 0; start < paths.length; start += BATCH) {
    const batch = paths.slice(start, start + BATCH);
    const { stdout } = await deps.runStat(batch).catch(() => ({ stdout: "", failed: true }));
    const flags = parseStatFlags(stdout);
    if (flags.size > 0) {
      // stat answered: its flags are the truth, and a path it did not print is missing.
      for (const [path, value] of flags) {
        if ((value & SF_DATALESS) !== 0) evicted.add(path);
      }
      continue;
    }
    // stat gave nothing at all (not there, killed by the timeout): the block count is a guess.
    for (const path of batch) {
      const info = await deps.lstat(path).catch(() => null);
      if (info && info.blocks === 0 && info.size > 0) evicted.add(path);
    }
  }
  return evicted;
}

/** Asks which of these paths are evicted. */
export type EvictionProbe = (paths: string[]) => Promise<ReadonlySet<string>>;

export const probeDataless: EvictionProbe = (paths) => datalessPaths(paths);

/**
 * A short per-path memory of the probe, for the `kaipu-media://` protocol: a grid of
 * thumbnails costs a few `stat` calls, not one per request, and a URL a renderer cached before
 * the file was evicted is still refused once the window has passed.
 */
export class EvictionCache {
  private readonly known = new Map<string, { evicted: boolean; at: number }>();

  constructor(
    private readonly probe: EvictionProbe,
    private readonly ttlMs: number = 2_000,
    private readonly now: () => number = Date.now,
  ) {}

  async isEvicted(path: string): Promise<boolean> {
    const hit = this.known.get(path);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.evicted;
    const evicted = (await this.probe([path])).has(path);
    this.known.set(path, { evicted, at: this.now() });
    if (this.known.size > 2_000) this.known.delete(this.known.keys().next().value!);
    return evicted;
  }

  forget(path: string): void {
    this.known.delete(path);
  }
}
