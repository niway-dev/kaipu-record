import { describe, expect, it } from "vitest";
import { RunRecorder, SAMPLES_HEADER, SYSTEM_HEADER, type Tick } from "./recorder";
import { runJsonSchema } from "./schema";

const proc = (pid: number, role: string, footprint: number, peak: number | null) => ({
  pid,
  ppid: 1,
  role,
  rssBytes: footprint / 2,
  cpuPct: 10,
  cpuTimeS: 5,
  threads: 4,
  footprintBytes: footprint,
  peakBytes: peak,
});

const system = {
  swapUsedBytes: 100,
  swapTotalBytes: 1000,
  compressedBytes: 50,
  freeBytes: 10,
  pressure: "normal" as const,
  loadAvg: [1, 2, 3] as [number, number, number],
};

const tick = (tMs: number, processes: Tick["processes"], outputBytes: number | null): Tick => ({
  tMs,
  processes,
  system,
  outputBytes,
  costMs: 100 + tMs / 100,
});

function recorder() {
  return new RunRecorder({
    machine: "owner-M5",
    ref: "abc1234",
    watched: true,
    maxStallMs: 30_000,
    phaseAt: (t) => (t < 2000 ? "start" : "export"),
  });
}

describe("RunRecorder", () => {
  it("emits one csv row per process per tick with the phase", () => {
    const r = recorder();
    const out = r.addTick(tick(0, [proc(1, "main", 100, 120), proc(2, "renderer", 50, 60)], 28));
    expect(out.sampleRows).toHaveLength(2);
    expect(out.sampleRows[0]!.split(",")).toHaveLength(SAMPLES_HEADER.split(",").length);
    expect(out.sampleRows[1]).toContain("renderer");
    expect(out.systemRow.split(",")).toHaveLength(SYSTEM_HEADER.split(",").length);
    expect(out.sampleRows[0]).toContain("start");
  });

  it("keeps the last lifetime peak of a process that exited, and marks it exited", () => {
    const r = recorder();
    r.addTick(tick(0, [proc(1, "main", 100, 120), proc(2, "renderer", 50, 900)], 28));
    r.addTick(tick(1000, [proc(1, "main", 110, 130)], 28));
    const run = r.finish({
      startedAt: "2026-11-19T10:00:00.000Z",
      endedAt: "2026-11-19T10:00:01.000Z",
      durationMs: 1000,
      phases: [{ label: "start", tMs: 0 }],
    });
    const renderer = run.processes.find((p) => p.pid === 2)!;
    expect(renderer.exited).toBe(true);
    expect(renderer.peakFootprintBytes).toBe(900);
    expect(run.processes.find((p) => p.pid === 1)!.exited).toBe(false);
    expect(run.roles.find((x) => x.role === "main")!.peakFootprintBytes).toBe(130);
  });

  it("marks every process exited when a final tick finds none", () => {
    const r = recorder();
    r.addTick(tick(0, [proc(1, "main", 100, 120)], null));
    r.addTick(tick(1000, [], null));
    const run = r.finish({ startedAt: "a", endedAt: "b", durationMs: 1000, phases: [] });
    expect(run.processes[0]!.exited).toBe(true);
  });

  it("reports unknown pressure when it was never readable, and keeps the worst otherwise", () => {
    const mk = (pressure: "normal" | "warn" | "unknown") => ({
      ...tick(0, [], null),
      system: { ...system, pressure },
    });
    const a = recorder();
    a.addTick(mk("unknown"));
    expect(
      a.finish({ startedAt: "a", endedAt: "b", durationMs: 0, phases: [] }).system.worstPressure,
    ).toBe("unknown");
    const b = recorder();
    b.addTick(mk("unknown"));
    b.addTick(mk("warn"));
    b.addTick(mk("normal"));
    expect(
      b.finish({ startedAt: "a", endedAt: "b", durationMs: 0, phases: [] }).system.worstPressure,
    ).toBe("warn");
  });

  it("falls back to the sampled max when no lifetime peak was read", () => {
    const r = recorder();
    r.addTick(tick(0, [proc(1, "main", 100, null)], null));
    const run = r.finish({ startedAt: "a", endedAt: "b", durationMs: 0, phases: [] });
    expect(run.processes[0]!.peakSource).toBe("sampled");
    expect(run.processes[0]!.peakFootprintBytes).toBe(100);
  });

  it("builds a run.json that validates, with the invariant over the output samples", () => {
    const r = recorder();
    for (let i = 0; i < 5; i++)
      r.addTick(tick(i * 1000, [proc(1, "main", 100, 120)], 28 + i * 1000));
    const run = r.finish({
      startedAt: "2026-11-19T10:00:00.000Z",
      endedAt: "2026-11-19T10:00:05.000Z",
      durationMs: 5000,
      phases: [{ label: "start", tMs: 0 }],
    });
    expect(runJsonSchema.safeParse(run).success).toBe(true);
    expect(run.series.key).toBe("field / dev / owner-M5");
    expect(run.invariant.held).toBe(true);
    expect(run.output.lastBytes).toBe(4028);
    expect(run.tickCostMs.max).toBeGreaterThan(0);
    expect(r.outputSamples()).toHaveLength(5);
  });
});
