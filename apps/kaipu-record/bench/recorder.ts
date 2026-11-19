import { checkOutputGrowthPerFile, type FileTick, type OutputSample } from "./invariant";
import type { PhaseMark } from "./phases";
import { SCHEMA_VERSION, type RunJson } from "./schema";

/** Sampling interval; the single definition for the loop and for run.json. */
export const TICK_INTERVAL_MS = 1000;

export interface ProcessSample {
  pid: number;
  ppid: number;
  role: string;
  rssBytes: number;
  cpuPct: number;
  cpuTimeS: number;
  threads: number;
  footprintBytes: number;
  /** Lifetime `phys_footprint_peak` as last reported by `footprint`. */
  peakBytes: number | null;
}

export interface SystemSample {
  swapUsedBytes: number;
  swapTotalBytes: number;
  compressedBytes: number;
  freeBytes: number;
  pressure: "normal" | "warn" | "critical" | "unknown";
  loadAvg: [number, number, number];
}

export interface Tick {
  tMs: number;
  processes: ProcessSample[];
  system: SystemSample;
  /** Total bytes of the watched export file(s); null if none exists or none watched. */
  outputBytes: number | null;
  /** Bytes per watched file, for judging each file alone. Omitted: `outputBytes` is one file. */
  outputFiles?: Map<string, number>;
  /** Wall time the whole sampling tick took. */
  costMs: number;
}

export const SAMPLES_HEADER =
  "t_ms,phase,pid,ppid,role,footprint_bytes,rss_bytes,cpu_pct,cpu_time_s,threads";
export const SYSTEM_HEADER =
  "t_ms,phase,swap_used_bytes,swap_total_bytes,compressed_bytes,free_bytes,pressure,load1,load5,load15,output_bytes";

/** CSV cell: phase labels are free text typed by the owner. */
function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface ProcState {
  pid: number;
  role: string;
  firstSeenMs: number;
  lastSeenMs: number;
  maxFootprint: number;
  maxRss: number;
  lifetimePeak: number | null;
}

export interface RecorderOptions {
  machine: string;
  ref: string;
  watched: boolean;
  maxStallMs: number;
  phaseAt: (tMs: number) => string;
}

const LIMITS = [
  "A renderer cannot be matched to a window from outside the app; roles come from the --type argument.",
  "Threads are the number of thread rows `ps -axM` lists for the pid at each tick.",
  "Dev build (bun run dev): numbers are not comparable with production-build series.",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Pure bookkeeping for one field run: turns ticks into csv rows and a run.json. */
export class RunRecorder {
  private readonly procs = new Map<number, ProcState>();
  private readonly out: OutputSample[] = [];
  private readonly fileTicks: FileTick[] = [];
  private readonly costs: number[] = [];
  private peakSwap = 0;
  private peakCompressed = 0;
  private worst: RunJson["system"]["worstPressure"] = "normal";
  private loadAtStart: [number, number, number] | null = null;
  private lastPresent = new Set<number>();

  constructor(private readonly opts: RecorderOptions) {}

  addTick(t: Tick): { sampleRows: string[]; systemRow: string } {
    const phase = this.opts.phaseAt(t.tMs);
    this.costs.push(t.costMs);
    this.loadAtStart ??= t.system.loadAvg;
    this.peakSwap = Math.max(this.peakSwap, t.system.swapUsedBytes);
    this.peakCompressed = Math.max(this.peakCompressed, t.system.compressedBytes);
    const rank = { normal: 0, unknown: 0, warn: 1, critical: 2 } as const;
    if (rank[t.system.pressure] > rank[this.worst]) this.worst = t.system.pressure;
    this.out.push({ tMs: t.tMs, bytes: t.outputBytes });
    this.fileTicks.push({
      tMs: t.tMs,
      files:
        t.outputFiles ?? (t.outputBytes === null ? new Map() : new Map([["_", t.outputBytes]])),
    });

    this.lastPresent = new Set(t.processes.map((p) => p.pid));
    const sampleRows = t.processes.map((p) => {
      const s = this.procs.get(p.pid) ?? {
        pid: p.pid,
        role: p.role,
        firstSeenMs: t.tMs,
        lastSeenMs: t.tMs,
        maxFootprint: 0,
        maxRss: 0,
        lifetimePeak: null,
      };
      s.lastSeenMs = t.tMs;
      s.maxFootprint = Math.max(s.maxFootprint, p.footprintBytes);
      s.maxRss = Math.max(s.maxRss, p.rssBytes);
      if (p.peakBytes !== null) s.lifetimePeak = Math.max(s.lifetimePeak ?? 0, p.peakBytes);
      this.procs.set(p.pid, s);
      return [
        t.tMs,
        cell(phase),
        p.pid,
        p.ppid,
        cell(p.role),
        p.footprintBytes,
        p.rssBytes,
        p.cpuPct,
        p.cpuTimeS.toFixed(2),
        p.threads,
      ].join(",");
    });
    const sys = t.system;
    const systemRow = [
      t.tMs,
      cell(phase),
      sys.swapUsedBytes,
      sys.swapTotalBytes,
      sys.compressedBytes,
      sys.freeBytes,
      sys.pressure,
      ...sys.loadAvg,
      t.outputBytes ?? "",
    ].join(",");
    return { sampleRows, systemRow };
  }

  outputSamples(): OutputSample[] {
    return this.out.map((s) => ({ ...s }));
  }

  finish(meta: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
    phases: PhaseMark[];
  }): RunJson {
    const processes = [...this.procs.values()]
      .sort((a, b) => a.pid - b.pid)
      .map((p) => ({
        pid: p.pid,
        role: p.role,
        firstSeenMs: p.firstSeenMs,
        lastSeenMs: p.lastSeenMs,
        exited: !this.lastPresent.has(p.pid),
        peakFootprintBytes: p.lifetimePeak ?? p.maxFootprint,
        peakSource: p.lifetimePeak === null ? ("sampled" as const) : ("footprint-peak" as const),
        maxSampledFootprintBytes: p.maxFootprint,
        maxRssBytes: p.maxRss,
      }));
    const roles = new Map<string, { processes: number; peak: number }>();
    for (const p of processes) {
      const r = roles.get(p.role) ?? { processes: 0, peak: 0 };
      r.processes++;
      r.peak = Math.max(r.peak, p.peakFootprintBytes);
      roles.set(p.role, r);
    }
    const existed = this.out.filter((s): s is { tMs: number; bytes: number } => s.bytes !== null);
    const inv = checkOutputGrowthPerFile(this.fileTicks, { maxStallMs: this.opts.maxStallMs });
    const costs = [...this.costs].sort((a, b) => a - b);
    const key = `field / dev / ${this.opts.machine}`;
    return {
      schemaVersion: SCHEMA_VERSION,
      series: { kind: "field", build: "dev", machine: this.opts.machine, key },
      ref: this.opts.ref,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      durationMs: meta.durationMs,
      tickIntervalMs: TICK_INTERVAL_MS,
      tickCostMs: {
        p50: percentile(costs, 0.5),
        p95: percentile(costs, 0.95),
        max: costs[costs.length - 1] ?? 0,
      },
      phases: meta.phases,
      processes,
      roles: [...roles.entries()].map(([role, r]) => ({
        role,
        processes: r.processes,
        peakFootprintBytes: r.peak,
      })),
      system: {
        peakSwapUsedBytes: this.peakSwap,
        peakCompressedBytes: this.peakCompressed,
        worstPressure: this.worst,
        loadAvgAtStart: this.loadAtStart ?? [0, 0, 0],
      },
      output: {
        watched: this.opts.watched,
        samples: existed.length,
        firstBytes: existed[0]?.bytes ?? null,
        lastBytes: existed[existed.length - 1]?.bytes ?? null,
        maxBytes: existed.length > 0 ? Math.max(...existed.map((s) => s.bytes)) : null,
      },
      invariant: {
        name: "output-grows-while-exporting",
        held: this.opts.watched ? inv.held : null,
        reason: this.opts.watched ? inv.reason : "no output file was watched",
        maxStallMs: inv.maxStallMs,
        longestStallMs: inv.longestStallMs,
        segments: inv.segments,
        growthEvents: inv.growthEvents,
      },
      limits: LIMITS,
    };
  }
}
