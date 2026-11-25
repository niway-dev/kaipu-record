import { z } from "zod";

/** `run.json` of a benchmark run. Field runs and (later) mini runs share this shape. */
export const SCHEMA_VERSION = 1;

const nonNegative = z.number().min(0);

export const runJsonSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  series: z.object({
    kind: z.enum(["field", "mini", "hosted"]),
    build: z.enum(["dev", "production"]),
    machine: z.string().min(1),
    key: z.string().min(1),
  }),
  ref: z.string().min(1),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: nonNegative,
  tickIntervalMs: z.number().positive(),
  tickCostMs: z.object({ p50: nonNegative, p95: nonNegative, max: nonNegative }),
  phases: z.array(z.object({ label: z.string(), tMs: nonNegative })),
  processes: z.array(
    z.object({
      pid: z.number().int(),
      role: z.string(),
      firstSeenMs: nonNegative,
      lastSeenMs: nonNegative,
      exited: z.boolean(),
      peakFootprintBytes: nonNegative,
      peakSource: z.enum(["footprint-peak", "sampled"]),
      maxSampledFootprintBytes: nonNegative,
      maxRssBytes: nonNegative,
    }),
  ),
  roles: z.array(
    z.object({ role: z.string(), processes: z.number().int(), peakFootprintBytes: nonNegative }),
  ),
  system: z.object({
    peakSwapUsedBytes: nonNegative,
    peakCompressedBytes: nonNegative,
    worstPressure: z.enum(["normal", "warn", "critical", "unknown"]),
    loadAvgAtStart: z.tuple([z.number(), z.number(), z.number()]),
  }),
  output: z.object({
    watched: z.boolean(),
    samples: z.number().int().min(0),
    firstBytes: nonNegative.nullable(),
    lastBytes: nonNegative.nullable(),
    maxBytes: nonNegative.nullable(),
  }),
  invariant: z.object({
    name: z.literal("output-grows-while-exporting"),
    held: z.boolean().nullable(),
    reason: z.string(),
    maxStallMs: nonNegative,
    longestStallMs: nonNegative,
    segments: z.number().int().min(0),
    growthEvents: z.number().int().min(0),
  }),
  limits: z.array(z.string()),
});

export type RunJson = z.infer<typeof runJsonSchema>;
