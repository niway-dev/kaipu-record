import React, { useEffect, useState } from "react";
import { ControlBar } from "./control-bar";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import { recordingModeChip } from "./recording-mode-label";
import type { RecordingTick } from "@shared/types/ipc";

const INITIAL_TICK: RecordingTick = {
  elapsedSeconds: 0,
  levels: [0, 0, 0, 0, 0],
  status: "recording",
};

/** Root mounted in the floating control-bar window (`?window=control-bar`). */
export function ControlBarWindowRoot(): React.JSX.Element {
  const [tick, setTick] = useState<RecordingTick>(INITIAL_TICK);
  const shortcuts = useShortcutLabels();
  const recording = useRecordingSettings();
  const modeChip = recordingModeChip(recording);

  useEffect(() => window.electronAPI.onControlTick(setTick), []);

  return (
    <ControlBar
      tick={tick}
      onPause={() => window.electronAPI.controlCommand("pause")}
      onResume={() => window.electronAPI.controlCommand("resume")}
      onStop={() => window.electronAPI.controlCommand("stop")}
      stopShortcut={shortcuts?.stopRecording}
      modeChip={modeChip}
    />
  );
}
