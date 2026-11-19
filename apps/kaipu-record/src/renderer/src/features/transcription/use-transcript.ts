import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TranscriptDocument, TranscriptReadResult } from "@shared/types/transcription";
import { getSnapshot, subscribe } from "./transcription-job-store";

export interface TranscriptApi {
  state: "loading" | "none" | "invalid" | "ready";
  transcript: TranscriptDocument | null;
  /** The recording changed after the transcript was made; its words stay readable. */
  stale: boolean;
  refresh(): Promise<void>;
}

interface Answer {
  forId: string;
  result: TranscriptReadResult;
}

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
    setAnswer({ forId: itemId, result });
  }, [itemId]);

  useEffect(() => {
    void read();
  }, [read, doneCount]);

  if (itemId === null) return { state: "none", transcript: null, stale: false, refresh: read };
  // After an id change the previous item's answer is still in state until the new read lands.
  if (answer?.forId !== itemId) {
    return { state: "loading", transcript: null, stale: false, refresh: read };
  }
  const { result } = answer;
  return {
    state: result.status,
    transcript: result.status === "ready" ? result.transcript : null,
    stale: result.status === "ready" && result.stale,
    refresh: read,
  };
}
