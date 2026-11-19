/** Parsers for macOS `footprint` output. Pure: no process spawning here. */

const UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
};

/** `footprint` prints binary units under KB/MB/GB labels (pages of 16 KiB). */
export function parseSize(value: string, unit: string): number | null {
  const mult = UNITS[unit.toUpperCase()];
  const n = Number(value);
  if (mult === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * mult);
}

export interface FootprintRow {
  pid: number;
  /** `phys_footprint`, or the header `Footprint:` when the line is missing. */
  footprintBytes: number;
  /** `phys_footprint_peak`: the lifetime peak of the process. */
  peakBytes: number | null;
}

const HEADER = /^(.*) \[(\d+)\]: .*Footprint: ([\d.]+) (B|KB|MB|GB)\b/;
const PHYS = /^\s*phys_footprint: ([\d.]+) (B|KB|MB|GB)\b/;
const PEAK = /^\s*phys_footprint_peak: ([\d.]+) (B|KB|MB|GB)\b/;

export function parseFootprint(text: string): FootprintRow[] {
  const rows: FootprintRow[] = [];
  let current: FootprintRow | null = null;
  for (const line of text.split("\n")) {
    const h = HEADER.exec(line);
    if (h) {
      const bytes = parseSize(h[3]!, h[4]!);
      current = { pid: Number(h[2]), footprintBytes: bytes ?? 0, peakBytes: null };
      rows.push(current);
      continue;
    }
    if (!current) continue;
    const p = PHYS.exec(line);
    if (p) {
      const b = parseSize(p[1]!, p[2]!);
      if (b !== null) current.footprintBytes = b;
      continue;
    }
    const k = PEAK.exec(line);
    if (k) current.peakBytes = parseSize(k[1]!, k[2]!);
  }
  return rows;
}
