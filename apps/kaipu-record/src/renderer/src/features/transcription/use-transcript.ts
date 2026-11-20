import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  TranscriptDocument,
  TranscriptFreshnessResult,
  TranscriptReadResult,
} from "@shared/types/transcription";
import { getSnapshot, subscribe } from "./transcription-job-store";

export interface TranscriptApi {
  state: "loading" | "none" | "invalid" | "ready";
  transcript: TranscriptDocument | null;
  /**
   * The recording changed after the transcript was made (or could not be checked); its words stay
   * readable. False while `freshness` is `checking`.
   */
  stale: boolean;
  /**
   * `checking`: the words are here and the media hash is still being settled in main, so nothing
   * claims the transcript is current or out of date yet. `unknown`: the check could not tell
   * (the file kept changing while it was hashed).
   */
  freshness: "fresh" | "stale" | "checking" | "unknown";
  /** The check found it stale and no automatic re-transcribe was made for this content yet. */
  autoRetranscribe: boolean;
  refresh(): Promise<void>;
}

interface Answer {
  forId: string;
  result: TranscriptReadResult;
  /** Main's verdict for this read; null until the check lands (or when none was needed). */
  verdict: TranscriptFreshnessResult | null;
}

const UNKNOWN_VERDICT: TranscriptFreshnessResult = { verdict: "unknown", autoRetranscribe: false };

/**
 * The transcript file of one library item, re-read when a job for that item finishes in this
 * session. An answer for an item that is no longer current is dropped.
 */
export function useTranscript(itemId: string | null): TranscriptApi {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const doneCount = useSyncExternalStore(subscribe, () =>
    itemId === null ? 0 : (getSnapshot().doneCounts[itemId] ?? 0),
  );
  const currentId = useRef<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    currentId.current = itemId;
    return () => {
      currentId.current = null;
    };
  }, [itemId]);

  const read = useCallback(async (): Promise<void> => {
    if (itemId === null) return;
    const turn = ++sequence.current;
    const result = await window.electronAPI
      .readTranscript(itemId)
      .catch((): TranscriptReadResult => ({ status: "none" }));
    // Two reads of the same item can overlap (a job ending during the first read); the older
    // answer must not overwrite the newer one.
    if (currentId.current !== itemId || sequence.current !== turn) return;
    setAnswer({ forId: itemId, result, verdict: null });
    // The words are on screen now. Whatever is not `fresh` is settled by a second call: a cold
    // cache needs the media hash, and a stale one asks whether an automatic retry is allowed.
    if (result.status !== "ready" || result.freshness === "fresh") return;
    const verdict = await window.electronAPI
      .checkTranscriptFreshness(itemId)
      .catch((): TranscriptFreshnessResult => UNKNOWN_VERDICT);
    if (currentId.current !== itemId || sequence.current !== turn) return;
    setAnswer((current) => (current?.forId === itemId ? { ...current, verdict } : current));
  }, [itemId]);

  useEffect(() => {
    void read();
  }, [read, doneCount]);

  const empty = { transcript: null, stale: false, autoRetranscribe: false, refresh: read };
  if (itemId === null) return { ...empty, state: "none", freshness: "fresh" };
  // After an id change the previous item's answer is still in state until the new read lands.
  if (answer?.forId !== itemId) return { ...empty, state: "loading", freshness: "checking" };
  const { result, verdict } = answer;
  if (result.status !== "ready") return { ...empty, state: result.status, freshness: "fresh" };
  const freshness = verdict ? verdict.verdict : result.freshness;
  return {
    state: "ready",
    transcript: result.transcript,
    // A transcript nobody could check is shown as out of date, with the manual button.
    stale: freshness === "stale" || freshness === "unknown",
    freshness,
    autoRetranscribe: verdict?.autoRetranscribe ?? false,
    refresh: read,
  };
}
