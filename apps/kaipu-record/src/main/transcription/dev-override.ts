import type {
  TranscriptionModelInfo,
  TranscriptionModelStatus,
  TranscriptionStatus,
} from "@shared/types/transcription";

/** What `KAIPU_TRANSCRIPTION` pins: how the default speech model is offered. */
export type TranscriptionOverride =
  | { kind: "missing" }
  | { kind: "downloading"; percent: number }
  | { kind: "ready" }
  | { kind: "failed" }
  | { kind: "unavailable" };

const DEFAULT_PERCENT = 42;

/**
 * Parses `KAIPU_TRANSCRIPTION`: `missing`, `downloading`, `downloading:<1-99>`, `ready`,
 * `failed` or `unavailable`. Anything else is no override.
 */
export function parseTranscriptionOverride(
  value: string | undefined,
): TranscriptionOverride | null {
  switch (value) {
    case "missing":
    case "ready":
    case "failed":
    case "unavailable":
      return { kind: value };
    case "downloading":
      return { kind: "downloading", percent: DEFAULT_PERCENT };
  }
  const match = value === undefined ? null : /^downloading:(\d{1,2})$/.exec(value);
  const percent = match ? Number(match[1]) : 0;
  return percent >= 1 ? { kind: "downloading", percent } : null;
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
