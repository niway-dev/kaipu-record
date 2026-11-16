import { useCallback, useRef, useSyncExternalStore } from "react";
import { useFlag } from "@renderer/features/analytics/use-flag";
import { transcribeControlState, type TranscribeControlState } from "./transcribe-control";
import {
  cancelRunningTranscription,
  getSnapshot,
  startTranscription,
  subscribe,
  type StartOutcome,
} from "./transcription-job-store";
import { useTranscriptionJob } from "./use-transcription-job";
import { useTranscriptionStatus } from "./use-transcription-status";

export interface TranscribeControlItem {
  id: string;
  assetId: string;
  /** `null` when the recording has no local media to decode. */
  mediaUrl: string | null;
  durationMs: number;
  /** Non-null when a transcript file exists; supplied by the Library list. */
  transcribedAt: number | null;
}

export interface TranscribeControl {
  state: TranscribeControlState;
  /** Starts a job when the control allows it; resolves `null` and does nothing otherwise. */
  start(): Promise<StartOutcome | null>;
  cancel(): void;
}

const STARTABLE: ReadonlySet<TranscribeControlState["kind"]> = new Set([
  "idle",
  "failed",
  "stale",
  "invalid",
]);

/**
 * The Transcribe control of one video. Existence of the transcript comes from the item's
 * `transcribedAt` plus jobs finished in this session, never from reading the file: a list of
 * cards must not read one file per card. So this hook never yields `stale` or `invalid`; a
 * caller that has read the transcript passes those to `transcribeControlState` itself.
 */
export function useTranscribeControl(item: TranscribeControlItem): TranscribeControl {
  const flagOn = useFlag("transcription");
  const { status } = useTranscriptionStatus({ enabled: flagOn });
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
    transcript: item.transcribedAt !== null || doneThisSession ? "ready" : "none",
    running,
    busyElsewhere,
    failure,
  });

  // `start` reads the latest values at call time so a click handler captured before a render
  // cannot start a job from a state that has since changed.
  const latest = useRef({ state, item, modelId: status?.defaultModelId ?? null });
  latest.current = { state, item, modelId: status?.defaultModelId ?? null };

  const start = useCallback(async (): Promise<StartOutcome | null> => {
    const { state: current, item: target, modelId } = latest.current;
    if (!STARTABLE.has(current.kind) || modelId === null || target.mediaUrl === null) return null;
    return startTranscription({
      itemId: target.id,
      assetId: target.assetId,
      modelId,
      mediaUrl: target.mediaUrl,
      durationMs: target.durationMs,
    });
  }, []);

  const cancel = useCallback((): void => {
    if (latest.current.state.kind === "running") cancelRunningTranscription();
  }, []);

  return { state, start, cancel };
}
