import type {
  TranscriptionFailure,
  TranscriptionModelInfo,
  TranscriptionModelStatus,
  TranscriptionStatus,
} from "@shared/types/transcription";

/**
 * A job pinned by `,job:<pin>` after `ready` (UI state catalog only). No engine runs: the next
 * job that begins is accepted, the renderer streams its audio as usual, and main answers with
 * this one progress report (see `dev-job-pin.ts`).
 */
export type TranscriptionJobPin =
  /** Stays at `segmentsDone` of `segmentsTotal`, transcribing, until it is cancelled. */
  | { kind: "running"; segmentsDone: number; segmentsTotal: number }
  /** Ends at once with this failure. */
  | { kind: "failed"; failure: TranscriptionFailure };

type ModelOverride =
  | { kind: "missing" }
  | { kind: "downloading"; percent: number }
  | { kind: "ready" }
  | { kind: "failed" }
  | { kind: "unavailable" };

/** What `KAIPU_TRANSCRIPTION` pins: how the default speech model is offered, and optionally a job. */
export type TranscriptionOverride = ModelOverride & { job?: TranscriptionJobPin };

const DEFAULT_PERCENT = 42;
const DEFAULT_RUNNING = { segmentsDone: 3, segmentsTotal: 12 } as const;

const JOB_FAILURES: Record<TranscriptionFailure, true> = {
  "no-audio": true,
  "engine-unavailable": true,
  "model-missing": true,
  "engine-failed": true,
  "write-failed": true,
  "item-changed": true,
};

function parseModelOverride(value: string): ModelOverride | null {
  switch (value) {
    case "missing":
    case "ready":
    case "failed":
    case "unavailable":
      return { kind: value };
    case "downloading":
      return { kind: "downloading", percent: DEFAULT_PERCENT };
  }
  const match = /^downloading:(\d{1,2})$/.exec(value);
  const percent = match ? Number(match[1]) : 0;
  return percent >= 1 ? { kind: "downloading", percent } : null;
}

function parseJobPin(value: string): TranscriptionJobPin | null {
  if (value === "running") return { kind: "running", ...DEFAULT_RUNNING };
  const running = /^running:(\d{1,3})\/(\d{1,3})$/.exec(value);
  if (running) {
    const [done, total] = [Number(running[1]), Number(running[2])];
    return total >= 1 && done <= total
      ? { kind: "running", segmentsDone: done, segmentsTotal: total }
      : null;
  }
  const failed = /^failed:([a-z-]+)$/.exec(value);
  if (failed && Object.hasOwn(JOB_FAILURES, failed[1])) {
    return { kind: "failed", failure: failed[1] as TranscriptionFailure };
  }
  return null;
}

/**
 * Parses `KAIPU_TRANSCRIPTION`: `missing`, `downloading`, `downloading:<1-99>`, `ready`,
 * `failed` or `unavailable`. `ready` may be followed by a job pin, `ready,job:running`,
 * `ready,job:running:<done>/<total>` or `ready,job:failed:<failure>` (a job needs the model).
 * Anything else is no override.
 */
export function parseTranscriptionOverride(
  value: string | undefined,
): TranscriptionOverride | null {
  if (value === undefined) return null;
  const [modelPart, jobPart, ...extra] = value.split(",");
  if (extra.length > 0) return null;
  const model = parseModelOverride(modelPart);
  if (!model) return null;
  if (jobPart === undefined) return model;
  if (model.kind !== "ready" || !jobPart.startsWith("job:")) return null;
  const job = parseJobPin(jobPart.slice("job:".length));
  return job ? { ...model, job } : null;
}

/**
 * The override for this build. For the UI state catalog and local checks, so unpackaged builds
 * only, like `KAIPU_FLAG_OVERRIDES` and `KAIPU_TEXT_RECOGNITION`: a packaged app ignores it.
 */
export function resolveTranscriptionOverride(
  value: string | undefined,
  opts: { isPackaged: boolean },
): TranscriptionOverride | null {
  return opts.isPackaged ? null : parseTranscriptionOverride(value);
}

function modelStatusOf(
  override: TranscriptionOverride,
  model: TranscriptionModelInfo,
): TranscriptionModelStatus {
  switch (override.kind) {
    case "downloading":
      return {
        state: "downloading",
        receivedBytes: Math.floor((model.sizeBytes * override.percent) / 100),
        totalBytes: model.sizeBytes,
      };
    case "ready":
      return { state: "ready" };
    case "failed":
      return { state: "failed", reason: "The download failed." };
    case "missing":
    case "unavailable":
      return { state: "missing" };
  }
}

/**
 * `status` as the override pins it: the default model's state and the engine's availability.
 * The catalog entry (label, size, location, license) stays the real one, so a shot shows real
 * values.
 */
export function applyTranscriptionOverride(
  override: TranscriptionOverride,
  status: TranscriptionStatus,
): TranscriptionStatus {
  return {
    ...status,
    availability:
      override.kind === "unavailable"
        ? { status: "unavailable", reason: "unsupported-platform" }
        : { status: "available" },
    models: status.models.map((model) =>
      model.id === status.defaultModelId
        ? { ...model, status: modelStatusOf(override, model) }
        : model,
    ),
    job: null,
  };
}
