import { useEffect, useState } from "react";
import type { RecordingActivity } from "@shared/types";

const IDLE: RecordingActivity = { active: false, status: "recording", elapsedSeconds: 0 };

/**
 * Global recording activity, shared across windows via the main-process hub.
 * Any window (the Record page when reopened mid-recording, the Capture Panel)
 * reads this to reflect an in-progress recording and refuse to start a second
 * one. Queries the current state on mount (in case a recording is already
 * running) and then subscribes to changes.
 */
export function useRecordingActivity(): RecordingActivity {
  const [activity, setActivity] = useState<RecordingActivity>(IDLE);

  useEffect(() => {
    void window.electronAPI.getRecordingState().then(setActivity);
    return window.electronAPI.onRecordingState(setActivity);
  }, []);

  return activity;
}
