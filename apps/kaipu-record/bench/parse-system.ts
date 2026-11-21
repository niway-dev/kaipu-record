/** Parsers for `ps`, `vm_stat`, `sysctl` output. Pure. */

export interface PsRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  cpuPct: number;
  /** Cumulative user + system CPU seconds. */
  cpuTimeS: number;
  command: string;
}

/** `ps` TIME: `mm:ss.cc`, `hh:mm:ss.cc` or `d-hh:mm:ss`. */
export function parseCpuTime(value: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return 0;
  const [, d, h, min, sec] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec);
}

/** Output of `ps -axo pid,ppid,rss,%cpu,time,command`. RSS is in KB. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      rssBytes: Number(m[3]) * 1024,
      cpuPct: Number(m[4]),
      cpuTimeS: parseCpuTime(m[5]!),
      command: m[6]!,
    });
  }
  return rows;
}

/**
 * Output of `ps -axM` (it ignores `-o`): a process row starts with USER and PID, and
 * each further thread is a continuation row with those columns blank.
 */
export function parsePsThreads(text: string): Map<number, number> {
  const counts = new Map<number, number>();
  let current: number | null = null;
  for (const line of text.split("\n")) {
    const head = /^(\S+)\s+(\d+)\s/.exec(line);
    if (head) {
      current = Number(head[2]);
      counts.set(current, 1);
    } else if (current !== null && /^\s+\S/.test(line)) {
      counts.set(current, (counts.get(current) ?? 0) + 1);
    }
  }
  return counts;
}

export interface VmStat {
  freeBytes: number;
  /** Physical memory the compressor occupies. */
  compressedBytes: number;
  /** Uncompressed size of what the compressor holds. */
  storedInCompressorBytes: number;
}

export function parseVmStat(text: string): VmStat {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384);
  const pages = (label: string): number =>
    Number(new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(text)?.[1] ?? 0) * page;
  return {
    freeBytes: pages("Pages free"),
    compressedBytes: pages("Pages occupied by compressor"),
    storedInCompressorBytes: pages("Pages stored in compressor"),
  };
}

const SWAP_UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

export function parseSwapUsage(text: string): { totalBytes: number; usedBytes: number } {
  const pick = (name: string): number => {
    const m = new RegExp(`${name} = ([\\d.]+)([KMG])`).exec(text);
    return m ? Number(m[1]) * SWAP_UNITS[m[2]!]! : 0;
  };
  return { totalBytes: pick("total"), usedBytes: pick("used") };
}

/** `sysctl -n vm.loadavg`: `{ 13.85 13.65 10.51 }`. */
export function parseLoadAvg(text: string): [number, number, number] {
  const n = text.match(/[\d.]+/g)?.map(Number) ?? [];
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0];
}

/** `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical. */
export function pressureName(level: number): "normal" | "warn" | "critical" | "unknown" {
  return level === 1 ? "normal" : level === 2 ? "warn" : level === 4 ? "critical" : "unknown";
}
