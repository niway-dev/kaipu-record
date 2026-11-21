import { describe, expect, it } from "vitest";
import { runJsonSchema, type RunJson } from "./schema";

const valid: RunJson = {
  schemaVersion: 1,
  series: { kind: "field", build: "dev", machine: "owner-M5", key: "field / dev / owner-M5" },
  ref: "83e38529a",
  startedAt: "2026-11-19T10:00:00.000Z",
  endedAt: "2026-11-19T10:01:00.000Z",
  durationMs: 60000,
  tickIntervalMs: 1000,
  tickCostMs: { p50: 150, p95: 220, max: 300 },
  phases: [{ label: "start", tMs: 0 }],
  processes: [
    {
      pid: 1,
      role: "main",
      firstSeenMs: 0,
      lastSeenMs: 60000,
      exited: false,
      peakFootprintBytes: 100,
      peakSource: "footprint-peak",
      maxSampledFootprintBytes: 90,
      maxRssBytes: 80,
    },
  ],
  roles: [{ role: "main", processes: 1, peakFootprintBytes: 100 }],
  system: {
    peakSwapUsedBytes: 0,
    peakCompressedBytes: 0,
    worstPressure: "normal",
    loadAvgAtStart: [1, 1, 1],
  },
  output: { watched: true, samples: 60, firstBytes: 28, lastBytes: 1000, maxBytes: 1000 },
  invariant: {
    name: "output-grows-while-exporting",
    held: true,
    reason: "ok",
    maxStallMs: 30000,
    longestStallMs: 0,
    segments: 1,
    growthEvents: 59,
  },
  limits: ["renderer cannot be matched to a window from outside the app"],
};

describe("runJsonSchema", () => {
  it("accepts a valid document", () => {
    expect(runJsonSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a wrong schema version and a missing series", () => {
    expect(runJsonSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
    const { series: _s, ...rest } = valid;
    expect(runJsonSchema.safeParse(rest).success).toBe(false);
  });
  it("accepts a null invariant verdict (inconclusive)", () => {
    const v = { ...valid, invariant: { ...valid.invariant, held: null } };
    expect(runJsonSchema.safeParse(v).success).toBe(true);
  });
});
