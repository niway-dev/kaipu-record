import { useSyncExternalStore } from "react";
import {
  getSnapshot,
  subscribe,
  type RunningTranscription,
  type StartFailure,
} from "./transcription-job-store";

export interface TranscriptionJobView {
  /** Set only when the running job is this item's. */
  running: RunningTranscription | null;
  /** A job for another item runs, so this item cannot start one now. */
  busyElsewhere: boolean;
  /** The last failure of this item in this session. */
  failure: StartFailure | null;
}

const IDLE_VIEW: TranscriptionJobView = { running: null, busyElsewhere: false, failure: null };

/** What the shared job store says about one item. */
export function useTranscriptionJob(itemId: string | null): TranscriptionJobView {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  if (itemId === null) return IDLE_VIEW;
  const running = snapshot.running;
  const mine = running?.itemId === itemId;
  return {
    running: mine ? running : null,
    busyElsewhere: running !== null && !mine,
    failure: snapshot.failures[itemId] ?? null,
  };
}
