import { useSyncExternalStore } from "react";
import {
  getRecorderSnapshot,
  pauseRecording,
  requestStartRecording,
  resumeRecording,
  stopOrCancelRecording,
  subscribeRecorder,
  type RecorderStatus,
  type StartInput,
} from "@renderer/features/recording/recorder-store";

export type { RecorderStatus, StartInput } from "@renderer/features/recording/recorder-store";

export interface ScreenRecorderControls {
  status: RecorderStatus;
  /** Current countdown tick (3→1) while a start is pending; null otherwise. */
  countdown: number | null;
  /** Begin the 3-2-1 countdown then start; `resolveInput` is called right as
   *  the countdown elapses so it always sees the latest quality/watermark. */
  requestStart(resolveInput: () => StartInput): void;
  /** Cancel a pending start, or stop an active recording — whichever applies. */
  stopOrCancel(): void;
  pause(): void;
  resume(): void;
}

/**
 * React binding onto the module-singleton recorder store (see
 * `recorder-store.ts`). Every consumer in this window reads the SAME state —
 * unlike a plain `useState` hook, remounting the component that calls this
 * does not reset anything, because the engine/countdown live outside React.
 */
export function useScreenRecorder(): ScreenRecorderControls {
  const snapshot = useSyncExternalStore(subscribeRecorder, getRecorderSnapshot);
  return {
    status: snapshot.status,
    countdown: snapshot.countdown,
    requestStart: requestStartRecording,
    stopOrCancel: stopOrCancelRecording,
    pause: pauseRecording,
    resume: resumeRecording,
  };
}
