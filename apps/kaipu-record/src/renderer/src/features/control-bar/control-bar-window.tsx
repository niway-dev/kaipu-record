import React, { useEffect, useState } from "react";
import { ControlBar } from "./control-bar";
import type { RecordingTick } from "@shared/types/ipc";

const INITIAL_TICK: RecordingTick = {
  elapsedSeconds: 0,
  levels: [0, 0, 0, 0, 0],
  status: "recording",
};

/** Root mounted in the floating control-bar window (`?window=control-bar`). */
export function ControlBarWindowRoot(): React.JSX.Element {
  const [tick, setTick] = useState<RecordingTick>(INITIAL_TICK);

  useEffect(() => window.electronAPI.onControlTick(setTick), []);

  return (
    <ControlBar
      tick={tick}
      onPause={() => window.electronAPI.controlCommand("pause")}
      onResume={() => window.electronAPI.controlCommand("resume")}
      onStop={() => window.electronAPI.controlCommand("stop")}
    />
  );
}
