import type {
  TranscriptionBeginResult,
  TranscriptionJobPhase,
  TranscriptionJobProgress,
} from "@shared/types/transcription";
import { NoAudioError, decodeAudioToPcm } from "./decode-audio";

/**
 * Main reports progress only between batches, and one batch may take up to 270 s (its deadline:
 * 30 s plus twice the batch's audio). The renderer must outwait that or it cancels a job that is
 * still inside its allowed time.
 */
export const TRANSCRIPTION_PROGRESS_TIMEOUT_MS = 330_000;

const TERMINAL_PHASES: ReadonlySet<TranscriptionJobPhase> = new Set([
  "done",
  "failed",
  "cancelled",
]);

export type TranscriptionRefusal = Extract<
  TranscriptionBeginResult,
  { status: "refused" }
>["reason"];

export type RunTranscriptionResult =
  /** Main did not start a job, so nothing was decoded or sent. */
  | { status: "refused"; reason: TranscriptionRefusal }
  /** The job reached a terminal phase (done, failed or cancelled), as main reported it. */
  | { status: "finished"; progress: TranscriptionJobProgress };

/**
 * Drives one transcription job from the renderer: asks main to begin, decodes the recording's
 * audio and streams it chunk by chunk, then waits for main's terminal progress.
 *
 * Resolves with the job's terminal progress. Rejects if main goes silent for
 * `progressTimeoutMs` after the renderer is done sending (or after a cancel), if an IPC call
 * fails, or with an `AbortError` when `signal` was already aborted, before any job existed. An
 * abort after that cancels the job in main and resolves with its `cancelled` progress.
 *
 * The progress listener is attached after `begin` answers, because the job id comes from that
 * answer, and before the first chunk is sent. It is removed on every exit.
 */
export async function runTranscriptionJob(args: {
  id: string;
  assetId: string;
  modelId: string;
  mediaUrl: string;
  durationMs: number;
  /** Set when the app, not a click, started this job; main records it as the item's one automatic attempt. */
  automatic?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: TranscriptionJobProgress) => void;
  progressTimeoutMs?: number;
}): Promise<RunTranscriptionResult> {
  const {
    id,
    assetId,
    modelId,
    mediaUrl,
    durationMs,
    automatic = false,
    signal,
    onProgress,
    progressTimeoutMs = TRANSCRIPTION_PROGRESS_TIMEOUT_MS,
  } = args;
  if (signal?.aborted) throw new DOMException("The transcription was aborted", "AbortError");

  const api = window.electronAPI;
  const begin = await api.beginTranscription({
    id,
    assetId,
    modelId,
    durationMs,
    ...(automatic ? { automatic: true } : {}),
  });
  if (begin.status === "refused") return { status: "refused", reason: begin.reason };
  const { jobId } = begin;

  /** Aborted when the renderer must stop decoding: a cancel, a failure, or main ending the job. */
  const stop = new AbortController();
  let settle: { resolve: (p: TranscriptionJobProgress) => void; reject: (e: unknown) => void };
  const terminal = new Promise<TranscriptionJobProgress>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // A rejection can land while the renderer is still streaming and nobody awaits `terminal` yet.
  terminal.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** True once the renderer has nothing more to do but wait for main. */
  let waiting = false;
  let closed = false;
  let cancelRequested = false;

  const armSilenceTimer = (): void => {
    if (closed) return;
    waiting = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      settle.reject(
        new Error(
          `Transcription job ${jobId} sent no progress for ${Math.round(progressTimeoutMs / 1000)} s`,
        ),
      );
    }, progressTimeoutMs);
  };

  const unsubscribe = api.onTranscriptionJobProgress((event) => {
    if (event.jobId !== jobId) return;
    onProgress?.(event);
    if (TERMINAL_PHASES.has(event.phase)) {
      clearTimeout(timer);
      stop.abort();
      settle.resolve(event);
    } else if (waiting) {
      armSilenceTimer();
    }
  });

  const cancel = (): void => {
    if (cancelRequested) return;
    cancelRequested = true;
    stop.abort();
    api.cancelTranscription(jobId).then(armSilenceTimer, (error: unknown) => settle.reject(error));
  };

  async function streamAudio(): Promise<void> {
    const chunks = decodeAudioToPcm({ url: mediaUrl }, { signal: stop.signal });
    let decodeError: unknown = null;
    try {
      while (!stop.signal.aborted) {
        let step: IteratorResult<ArrayBuffer>;
        try {
          step = await chunks.next();
        } catch (error) {
          decodeError = error;
          break;
        }
        if (step.done) break;
        await api.sendTranscriptionAudio(jobId, step.value);
      }
    } finally {
      await chunks.return(undefined);
    }
    if (stop.signal.aborted) return;
    if (decodeError) {
      await api.failTranscriptionAudio(
        jobId,
        decodeError instanceof NoAudioError ? "no-audio" : "decode-failed",
      );
    } else {
      await api.endTranscriptionAudio(jobId);
    }
    armSilenceTimer();
  }

  try {
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    await streamAudio();
    return { status: "finished", progress: await terminal };
  } catch (error) {
    if (!cancelRequested) api.cancelTranscription(jobId).catch(() => {});
    throw error;
  } finally {
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    unsubscribe();
  }
}
