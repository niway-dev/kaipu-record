import React, { useLayoutEffect, useState } from "react";
import { ControlBar } from "./control-bar";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import { recordingModeChip } from "./recording-mode-label";
import { CONTROL_BAR_STARTING_TICK, type RecordingTick } from "@shared/types/ipc";

/** Root mounted in the floating control-bar window (`?window=control-bar`). */
export function ControlBarWindowRoot(): React.JSX.Element {
  // A new bar window opens for a take whose streams are still being acquired: "starting",
  // never a frozen "00:00" that reads as recording.
  const [tick, setTick] = useState<RecordingTick>(CONTROL_BAR_STARTING_TICK);
  const shortcuts = useShortcutLabels();
  const recording = useRecordingSettings();
  const modeChip = recordingModeChip(recording);

  // Subscribed before the first paint, so the tick main replays on `ready-to-show` (which
  // follows that paint) always finds a listener.
  useLayoutEffect(() => window.electronAPI.onControlTick(setTick), []);

  return (
    <ControlBar
      tick={tick}
      onPause={() => window.electronAPI.controlCommand("pause")}
      onResume={() => window.electronAPI.controlCommand("resume")}
      onStop={() => window.electronAPI.controlCommand("stop")}
      stopShortcut={shortcuts?.stopRecording}
      modeChip={modeChip}
      onCameraOff={
        recording.isCameraEnabled ? () => recording.update({ isCameraEnabled: false }) : undefined
      }
    />
  );
}
