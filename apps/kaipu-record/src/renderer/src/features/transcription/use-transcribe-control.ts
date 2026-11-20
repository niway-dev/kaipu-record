import { useCallback, useRef, useSyncExternalStore } from "react";
import { useFlag } from "@renderer/features/analytics/use-flag";
import {
  STARTABLE,
  transcribeControlState,
  type TranscribeControlState,
} from "./transcribe-control";
import {
  cancelRunningTranscription,
  getSnapshot,
  startTranscription,
  subscribe,
  type StartOutcome,
} from "./transcription-job-store";
import { useTranscriptionJob } from "./use-transcription-job";
import { useTranscriptionStatus, type TranscriptionStatusApi } from "./use-transcription-status";

export interface TranscribeControlItem {
  id: string;
  assetId: string;
  /** `null` when the recording has no local media to decode. */
  mediaUrl: string | null;
  durationMs: number;
  /** Non-null when a transcript file exists; supplied by the Library list. */
  transcribedAt: number | null;
  /** `true` when the caller has read that a transcript file exists and has no timestamp for it. */
  hasTranscript?: boolean;
}

export interface TranscribeControl {
  state: TranscribeControlState;
  /**
   * Starts a job when the control allows it; resolves `null` and does nothing otherwise.
   * `automatic` marks a job the app starts by itself, so main can keep its loop guard.
   */
  start(options?: { automatic?: boolean }): Promise<StartOutcome | null>;
  cancel(): void;
  /**
   * The model status this control reads, with its download, cancel and refresh calls, so the
   * download offer a control opens changes the same state the control shows.
   */
  offer: TranscriptionStatusApi;
}

/**
 * The Transcribe control of one video. This hook never reads the transcript file itself: a list
 * of cards must not read one file per card. Existence comes from the item's `transcribedAt`, or
 * from `hasTranscript` when the caller has already read the file (the editor does), plus jobs
 * finished in this session. So it never yields `stale` or `invalid`; a caller that has read the
 * transcript passes those to `transcribeControlState` itself.
 */
export function useTranscribeControl(item: TranscribeControlItem): TranscribeControl {
  const flagOn = useFlag("transcription");
  const offer = useTranscriptionStatus({ enabled: flagOn });
  const { status } = offer;
  const { running, busyElsewhere, failure } = useTranscriptionJob(item.id);
  const doneThisSession = useSyncExternalStore(
    subscribe,
    () => (getSnapshot().doneCounts[item.id] ?? 0) > 0,
  );

  const defaultModel = status?.models.find((m) => m.id === status.defaultModelId);
  const state = transcribeControlState({
    flagOn,
    hasLocalMedia: item.mediaUrl !== null,
    availability: status?.availability ?? null,
    defaultModelReady: status ? defaultModel?.status.state === "ready" : null,
    downloading: defaultModel?.status.state === "downloading",
    transcript:
      item.transcribedAt !== null || item.hasTranscript === true || doneThisSession
        ? "ready"
        : "none",
    running,
    busyElsewhere,
    failure,
  });

  // `start` reads the latest values at call time so a click handler captured before a render
  // cannot start a job from a state that has since changed.
  const latest = useRef({ state, item, modelId: status?.defaultModelId ?? null });
  latest.current = { state, item, modelId: status?.defaultModelId ?? null };

  const start = useCallback(
    async (options?: { automatic?: boolean }): Promise<StartOutcome | null> => {
      const { state: current, item: target, modelId } = latest.current;
      if (!STARTABLE.has(current.kind) || modelId === null || target.mediaUrl === null) return null;
      return startTranscription({
        itemId: target.id,
        assetId: target.assetId,
        modelId,
        mediaUrl: target.mediaUrl,
        durationMs: target.durationMs,
        ...(options?.automatic ? { automatic: true } : {}),
      });
    },
    [],
  );

  const cancel = useCallback((): void => {
    if (latest.current.state.kind === "running") cancelRunningTranscription();
  }, []);

  return { state, start, cancel, offer };
}
