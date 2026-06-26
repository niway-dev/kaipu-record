import React, { useEffect, useRef } from "react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
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
      <PanelHeader isRecording={setup.isRecording} onOpenMainWindow={openMain} />

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

      {/* Recording runs in the main window renderer (getDisplayMedia/WebCodecs
          live there), not this transparent panel — so the button opens the
          main window instead of recording here (see Option A). */}
      <RecordButton
        variant="compact"
        isRecording={setup.isRecording}
        shortcut="⌘⇧6"
        onClick={openMain}
      />
    </div>
  );
}
