import type { OutputSample } from "./invariant";
import type { RunJson } from "./schema";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${Number(v.toFixed(1))} ${units[i]}`;
}

/** `count` evenly spaced samples (by index) from those where the file existed. */
export function outputCheckpoints(
  samples: OutputSample[],
  count: number,
): { tMs: number; bytes: number }[] {
  const existed = samples.filter((s): s is { tMs: number; bytes: number } => s.bytes !== null);
  if (existed.length === 0) return [];
  if (existed.length <= count) return existed.map((s) => ({ ...s }));
  return Array.from({ length: count }, (_, i) => {
    const s = existed[Math.round((i * (existed.length - 1)) / (count - 1))]!;
    return { tMs: s.tMs, bytes: s.bytes };
  });
}

export function renderSummary(run: RunJson, checkpoints: { tMs: number; bytes: number }[]): string {
  const lines: string[] = [];
  lines.push(`Run ${run.series.key} at ${run.ref}, ${Math.round(run.durationMs / 1000)} s`);
  lines.push("Peak physical footprint per role (lifetime peak):");
  for (const r of [...run.roles].sort((a, b) => b.peakFootprintBytes - a.peakFootprintBytes)) {
    lines.push(
      `  ${r.role.padEnd(36)} ${formatBytes(r.peakFootprintBytes).padStart(10)}  (${r.processes} process${r.processes === 1 ? "" : "es"})`,
    );
  }
  lines.push(
    `System: peak swap ${formatBytes(run.system.peakSwapUsedBytes)}, peak compressed ${formatBytes(run.system.peakCompressedBytes)}, worst pressure ${run.system.worstPressure}`,
  );
  if (!run.output.watched) {
    lines.push("Output file: not watched");
  } else if (checkpoints.length === 0) {
    lines.push("Output file: never appeared");
  } else {
    lines.push(
      "Output bytes over time: " +
        checkpoints.map((c) => `${Math.round(c.tMs / 1000)}s=${formatBytes(c.bytes)}`).join("  "),
    );
  }
  const v = run.invariant;
  const verdict = v.held === true ? "HELD" : v.held === false ? "VIOLATED" : "INCONCLUSIVE";
  lines.push(`Invariant "${v.name}": ${verdict} (${v.reason})`);
  return lines.join("\n");
}
