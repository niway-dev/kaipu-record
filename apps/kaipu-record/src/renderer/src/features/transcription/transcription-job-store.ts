import type {
  TranscriptionFailure,
  TranscriptionJobPhase,
  TranscriptionJobProgress,
} from "@shared/types/transcription";
import { NoAudioError } from "./audio/decode-audio";
import { runTranscriptionJob, type TranscriptionRefusal } from "./audio/run-transcription-job";

export interface RunningTranscription {
  itemId: string;
  /** `starting` covers the time before main reports its first progress. */
  phase: TranscriptionJobPhase | "starting";
  segmentsDone: number;
  segmentsTotal: number;
}

/** Why a job failed. `unknown` is an IPC failure or a progress timeout, not an engine verdict. */
export type StartFailure = TranscriptionFailure | "decode-failed" | "unknown";

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

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/**
 * Runs one transcription and mirrors its progress into the store. Resolves with how it ended;
 * never rejects. A job already running answers `refused: busy` without calling main.
 */
export async function startTranscription(args: {
  itemId: string;
  assetId: string;
  modelId: string;
  mediaUrl: string;
  durationMs: number;
}): Promise<StartOutcome> {
  if (snapshot.running) return { status: "refused", reason: "busy" };

  const { itemId, assetId, modelId, mediaUrl, durationMs } = args;
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
  // One publish for the end of the job and its result, so a subscriber never sees the job gone
  // before the failure or the done count that explains it.
  publish({
    running: null,
    failures:
      outcome.status === "failed"
        ? { ...snapshot.failures, [itemId]: outcome.failure }
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
