import React, { useEffect, useRef } from "react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { SourceCard } from "@renderer/features/recording/components/source-card";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { MicPicker } from "@renderer/features/recording/components/mic-picker";
import { RecordButton } from "@renderer/features/recording/components/record-button";
import { PanelHeader } from "./components/panel-header";
import styles from "./capture-panel.module.css";

// Compact composition of the recording controls, shown from the menu-bar tray.
// Reuses the same dumb components + useRecordingSetup hook as the Record page.
export function CapturePanel(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const setup = useRecordingSetup();
  // Same source loading/default-selection as the Record page, so both windows
  // show the same screen instead of a hardcoded placeholder.
  useSourceSelection(setup);

  // The recording runs in another window, so this panel learns about it through
  // the global activity broadcast — it can't tell from its own (idle) recorder.
  const activity = useRecordingActivity();
  const isBusy = activity.active;
  const stopRecording = (): void => window.electronAPI?.controlCommand("stop");

  // Keep the Electron window height matched to the content (mic menu, etc.).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      window.electronAPI?.resizeCapturePanel(el.offsetHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const openMain = (): void => window.electronAPI?.openMainWindow();

  return (
    <div ref={rootRef} className={styles.panel}>
      <PanelHeader isRecording={isBusy} onOpenMainWindow={openMain} />

      {/* While a recording is in progress its settings are locked — changing the
          source/mic mid-recording does nothing, so the controls go inert. */}
      <div
        className={styles.lockable}
        data-locked={isBusy || undefined}
        inert={isBusy || undefined}
      >
        <SourceCard source={setup.selectedSource} variant="compact" onChoose={openMain} />

        <RecordingToggles
          variant="compact"
          isMicrophoneEnabled={setup.isMicrophoneEnabled}
          isSystemAudioEnabled={setup.isSystemAudioEnabled}
          isCameraEnabled={setup.isCameraEnabled}
          onToggleMicrophone={setup.toggleMicrophone}
          onToggleSystemAudio={setup.toggleSystemAudio}
          onToggleCamera={setup.toggleCamera}
        />

        {setup.isMicrophoneEnabled && setup.microphones.length > 0 && (
          <MicPicker
            variant="compact"
            microphones={setup.microphones}
            selected={setup.selectedMicrophone}
            isOpen={setup.isMicrophoneMenuOpen}
            onToggle={setup.toggleMicrophoneMenu}
            onSelect={setup.selectMicrophone}
          />
        )}
      </div>

      {/* Recording runs in the main window renderer (getDisplayMedia/WebCodecs
          live there), not this transparent panel. While idle the button opens
          the main window; while recording it stops via the hub command. */}
      <RecordButton
        variant="compact"
        isRecording={isBusy}
        shortcut="⌘⇧6"
        onClick={isBusy ? stopRecording : openMain}
      />
    </div>
  );
}
