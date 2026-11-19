import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { discoverProcesses, type FoundProcess } from "./discover";
import { parseFootprint, type FootprintRow } from "./parse-footprint";
import {
  parseLoadAvg,
  parsePs,
  parsePsThreads,
  parseSwapUsage,
  parseVmStat,
  pressureName,
  type PsRow,
} from "./parse-system";
import type { ProcessSample, SystemSample } from "./recorder";
import { globToRegExp, splitWatchSpec } from "./watch";

const run = promisify(execFile);

/** Runs a command and returns stdout even when it exits non-zero (a pid may have died). */
async function out(cmd: string, args: string[]): Promise<string> {
  try {
    return (await run(cmd, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (e) {
    return (e as { stdout?: string }).stdout ?? "";
  }
}

export async function readProcessTable(): Promise<PsRow[]> {
  return parsePs(await out("ps", ["-axo", "pid,ppid,rss,%cpu,time,command"]));
}

export async function readFootprints(
  pids: number[],
): Promise<{ rows: FootprintRow[]; error: string | null }> {
  if (pids.length === 0) return { rows: [], error: null };
  const args = ["-f", "bytes", "--noCategories"];
  for (const p of pids) args.push("-p", String(p));
  try {
    const r = await run("footprint", args, { maxBuffer: 64 * 1024 * 1024 });
    return { rows: parseFootprint(r.stdout), error: null };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const rows = parseFootprint(err.stdout ?? "");
    const detail = (err.stderr || err.message || "unknown error").trim().split("\n")[0];
    return { rows, error: rows.length === 0 ? `footprint failed: ${detail}` : null };
  }
}

export async function readSystem(): Promise<SystemSample> {
  const [vm, swap, load, pressure] = await Promise.all([
    out("vm_stat", []),
    out("sysctl", ["vm.swapusage"]),
    out("sysctl", ["-n", "vm.loadavg"]),
    out("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
  ]);
  const v = parseVmStat(vm);
  const s = parseSwapUsage(swap);
  return {
    swapUsedBytes: Math.round(s.usedBytes),
    swapTotalBytes: Math.round(s.totalBytes),
    compressedBytes: v.compressedBytes,
    freeBytes: v.freeBytes,
    pressure: pressureName(Number(pressure.trim())),
    loadAvg: parseLoadAvg(load),
  };
}

export interface ProcessReading {
  found: FoundProcess[];
  processes: ProcessSample[];
  system: SystemSample;
  /** Set when processes were found but `footprint` gave nothing for them. */
  error: string | null;
}

/** One tick: ps (+threads) and system in parallel, then one `footprint` call for every pid. */
export async function readTick(rootContains: string): Promise<ProcessReading> {
  const [table, threadsText, system] = await Promise.all([
    readProcessTable(),
    out("ps", ["-axM"]),
    readSystem(),
  ]);
  const found = discoverProcesses(table, { rootContains });
  const fp = await readFootprints(found.map((f) => f.pid));
  const footprints = new Map(fp.rows.map((f) => [f.pid, f]));
  const threads = parsePsThreads(threadsText);
  const byPid = new Map(table.map((r) => [r.pid, r]));
  const processes: ProcessSample[] = [];
  for (const f of found) {
    const ps = byPid.get(f.pid);
    const row = footprints.get(f.pid);
    if (!ps || !row) continue; // exited between the two reads
    processes.push({
      pid: f.pid,
      ppid: f.ppid,
      role: f.role,
      rssBytes: ps.rssBytes,
      cpuPct: ps.cpuPct,
      cpuTimeS: ps.cpuTimeS,
      threads: threads.get(f.pid) ?? 0,
      footprintBytes: row.footprintBytes,
      peakBytes: row.peakBytes,
    });
  }
  return { found, processes, system, error: fp.error };
}

/** Bytes per file matching the watch spec. Names are kept in memory only, never written. */
export function readWatchedFiles(spec: string): Map<string, number> {
  const isDir = (p: string): boolean => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const { dir, pattern } = splitWatchSpec(spec, isDir);
  const re = globToRegExp(pattern);
  const files = new Map<string, number>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return files;
  }
  for (const n of names) {
    if (!re.test(n) || n.startsWith(".DS_Store")) continue;
    try {
      const st = statSync(`${dir}/${n}`);
      if (st.isFile()) files.set(n, st.size);
    } catch {
      // the file was renamed between readdir and stat
    }
  }
  return files;
}

/** Total bytes of the watched files; null when none exist. */
export function totalBytes(files: Map<string, number>): number | null {
  if (files.size === 0) return null;
  let total = 0;
  for (const b of files.values()) total += b;
  return total;
}

export async function gitHead(cwd: string): Promise<string> {
  return (await out("git", ["-C", cwd, "rev-parse", "--short=9", "HEAD"])).trim() || "unknown";
}

export async function gitRoot(cwd: string): Promise<string | null> {
  const r = (await out("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).trim();
  return r || null;
}
