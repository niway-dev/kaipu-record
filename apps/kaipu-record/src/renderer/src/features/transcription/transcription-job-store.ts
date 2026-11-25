import type {
  TranscriptionFailure,
  TranscriptionJobPhase,
  TranscriptionJobProgress,
} from "@shared/types/transcription";
import { NoAudioError } from "./audio/decode-audio";
import { runTranscriptionJob, type TranscriptionRefusal } from "./audio/run-transcription-job";
import { refreshTranscriptionStatus } from "./use-transcription-status";

export interface RunningTranscription {
  itemId: string;
  /** `starting` covers the time before main reports its first progress. */
  phase: TranscriptionJobPhase | "starting";
  segmentsDone: number;
  segmentsTotal: number;
}

/**
 * Why a job failed or was never accepted. `busy` is main refusing because its engine is already
 * in use. `unknown` is an IPC failure or a progress timeout, not an engine verdict.
 */
export type StartFailure =
  | TranscriptionFailure
  | "decode-failed"
  | "busy"
  /** The media is offloaded by a sync provider: it has to be downloaded first. */
  | "evicted"
  | "unknown";

export type StartOutcome =
  | { status: "done" }
  | { status: "cancelled" }
  | { status: "failed"; failure: StartFailure }
  | { status: "refused"; reason: TranscriptionRefusal };

export interface TranscriptionJobStoreSnapshot {
  /** The one job in flight: main runs one at a time. */
  running: RunningTranscription | null;
  /** The last failure per item in this session; cleared when that item starts again. */
  failures: Readonly<Record<string, StartFailure>>;
  /** How many jobs finished with `done` per item in this session; a change means a new file. */
  doneCounts: Readonly<Record<string, number>>;
}

const EMPTY: TranscriptionJobStoreSnapshot = { running: null, failures: {}, doneCounts: {} };

let snapshot = EMPTY;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function publish(next: TranscriptionJobStoreSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): TranscriptionJobStoreSnapshot {
  return snapshot;
}

/** Test seam: forgets the running job, every failure and every done count. */
export function resetTranscriptionJobStore(): void {
  controller?.abort();
  controller = null;
  listeners.clear();
  snapshot = EMPTY;
}

/**
 * What the user is told when main refuses to begin a job. `unavailable` and `model-missing` are
 * absent on purpose: they mean the renderer's model status is out of date (the model was removed
 * in another window or deleted from disk), so a stored failure would rank above the corrected
 * "needs model" or "unavailable" control and click-retrying would hit the same refusal. Those two
 * refresh the shared status instead and the control follows it.
 */
const REFUSAL_FAILURE: Partial<Record<TranscriptionRefusal, StartFailure>> = {
  busy: "busy",
  "invalid-item": "item-changed",
  evicted: "evicted",
};

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/**
 * Runs one transcription and mirrors its progress into the store. Resolves with how it ended;
 * never rejects. A job already running answers `refused: busy` without calling main and records
 * nothing: the controls already show that state. Main's `busy`, `invalid-item` and `evicted` refusals are
 * recorded as the item's failure, so the click that was refused says why; its `unavailable` and
 * `model-missing` refusals mean the model status is stale, so they refresh it instead. An
 * automatic start that main refuses as `busy` (another window already took this content) records
 * nothing: nobody clicked, so there is nothing to explain.
 */
export async function startTranscription(args: {
  itemId: string;
  assetId: string;
  modelId: string;
  mediaUrl: string;
  durationMs: number;
  /** Set when the app started this job on its own (the stale auto re-transcribe). */
  automatic?: boolean;
}): Promise<StartOutcome> {
  if (snapshot.running) return { status: "refused", reason: "busy" };

  const { itemId, assetId, modelId, mediaUrl, durationMs, automatic } = args;
  const own = new AbortController();
  controller = own;
  // Claimed before the first await, so two starts in the same tick cannot both pass the check.
  publish({
    ...snapshot,
    failures: withoutKey(snapshot.failures, itemId),
    running: { itemId, phase: "starting", segmentsDone: 0, segmentsTotal: 0 },
  });

  const mirror = (progress: TranscriptionJobProgress): void => {
    if (controller !== own || !snapshot.running) return;
    publish({
      ...snapshot,
      running: {
        itemId,
        phase: progress.phase,
        segmentsDone: progress.segmentsDone,
        segmentsTotal: progress.segmentsTotal,
      },
    });
  };

  let outcome: StartOutcome;
  try {
    const result = await runTranscriptionJob({
      id: itemId,
      assetId,
      modelId,
      mediaUrl,
      durationMs,
      ...(automatic ? { automatic: true } : {}),
      signal: own.signal,
      onProgress: mirror,
    });
    if (result.status === "refused") outcome = { status: "refused", reason: result.reason };
    else if (result.progress.phase === "done") outcome = { status: "done" };
    else if (result.progress.phase === "cancelled") outcome = { status: "cancelled" };
    else outcome = { status: "failed", failure: result.progress.failure ?? "unknown" };
  } catch (error) {
    if (error instanceof NoAudioError) outcome = { status: "failed", failure: "no-audio" };
    else if (error instanceof DOMException && error.name === "AbortError")
      outcome = { status: "cancelled" };
    else outcome = { status: "failed", failure: "unknown" };
  }

  if (controller === own) controller = null;
  if (outcome.status === "refused" && REFUSAL_FAILURE[outcome.reason] === undefined) {
    void refreshTranscriptionStatus();
  }
  // One publish for the end of the job and its result, so a subscriber never sees the job gone
  // before the failure or the done count that explains it.
  publish({
    running: null,
    failures:
      outcome.status === "failed"
        ? { ...snapshot.failures, [itemId]: outcome.failure }
        : outcome.status === "refused" &&
            REFUSAL_FAILURE[outcome.reason] !== undefined &&
            !(automatic && outcome.reason === "busy")
          ? { ...snapshot.failures, [itemId]: REFUSAL_FAILURE[outcome.reason]! }
          : snapshot.failures,
    doneCounts:
      outcome.status === "done"
        ? { ...snapshot.doneCounts, [itemId]: (snapshot.doneCounts[itemId] ?? 0) + 1 }
        : snapshot.doneCounts,
  });
  return outcome;
}

/** Cancels the running job, if any. The job's promise then resolves with `cancelled`. */
export function cancelRunningTranscription(): void {
  controller?.abort();
}
