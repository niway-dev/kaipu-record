import type { TranscriptionStatus } from "@shared/types/transcription";
import type { RunningTranscription, StartFailure } from "./transcription-job-store";

export interface TranscribeControlInput {
  flagOn: boolean;
  hasLocalMedia: boolean;
  /** `null`: the engine status is not loaded yet. */
  availability: TranscriptionStatus["availability"] | null;
  /** Whether the default model is installed; `null` when unknown. */
  defaultModelReady: boolean | null;
  /** The default model is being downloaded now. */
  downloading: boolean;
  transcript: "none" | "ready" | "stale" | "invalid" | "unknown";
  /** The job running for this item, if any. */
  running: RunningTranscription | null;
  /** A job for another item runs. */
  busyElsewhere: boolean;
  /** The last failure of this item in this session. */
  failure: StartFailure | null;
}

export type TranscribeControlState =
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "loading" }
  | { kind: "needs-model" }
  | { kind: "model-downloading" }
  | { kind: "idle" }
  | {
      kind: "running";
      phase: RunningTranscription["phase"];
      segmentsDone: number;
      segmentsTotal: number;
    }
  | { kind: "busy-elsewhere" }
  | { kind: "failed"; failure: StartFailure }
  | { kind: "done" }
  | { kind: "stale" }
  | { kind: "invalid" };

/**
 * What the Transcribe control of one video shows. The first matching rule wins:
 *
 * 1. `hidden`: flag off, or no local media to decode.
 * 2. `running`: this item's job is in flight, whatever else is true.
 * 3. `unavailable`: the engine cannot run on this machine.
 * 4. `loading`: the engine or model status has not arrived.
 * 5. `failed`: the last attempt failed and there is no transcript to fall back on.
 * 6. `done`, `stale`, `invalid`: a transcript file exists (ready, out of date, unreadable).
 * 7. `busy-elsewhere`: another item's job holds the engine.
 * 8. `model-downloading`, then `needs-model`: the default model is not installed.
 * 9. `idle`: nothing stands in the way of starting.
 *
 * A transcript that exists outranks a busy engine or a missing model because opening it needs
 * neither; only starting a new one does.
 */
export function transcribeControlState(input: TranscribeControlInput): TranscribeControlState {
  if (!input.flagOn || !input.hasLocalMedia) return { kind: "hidden" };
  if (input.running) {
    return {
      kind: "running",
      phase: input.running.phase,
      segmentsDone: input.running.segmentsDone,
      segmentsTotal: input.running.segmentsTotal,
    };
  }
  if (input.availability?.status === "unavailable") return { kind: "unavailable" };
  if (input.availability === null || input.defaultModelReady === null) return { kind: "loading" };
  const hasNoTranscript = input.transcript === "none" || input.transcript === "unknown";
  if (input.failure !== null && hasNoTranscript) return { kind: "failed", failure: input.failure };
  if (input.transcript === "ready") return { kind: "done" };
  if (input.transcript === "stale") return { kind: "stale" };
  if (input.transcript === "invalid") return { kind: "invalid" };
  if (input.busyElsewhere) return { kind: "busy-elsewhere" };
  if (input.downloading) return { kind: "model-downloading" };
  if (!input.defaultModelReady) return { kind: "needs-model" };
  return { kind: "idle" };
}
