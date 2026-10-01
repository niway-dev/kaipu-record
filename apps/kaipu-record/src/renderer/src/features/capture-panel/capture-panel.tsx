import React, { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { RecordingIndicator } from "@renderer/features/recording/components/recording-indicator";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { SourceCard } from "@renderer/features/recording/components/source-card";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { MicPicker } from "@renderer/features/recording/components/mic-picker";
import { RecordButton } from "@renderer/features/recording/components/record-button";
import { PanelHeader } from "./components/panel-header";
import { PanelTabs, type PanelTab } from "./components/panel-tabs";
import styles from "./capture-panel.module.css";

// Compact composition of the recording controls, shown from the menu-bar tray.
// Reuses the same dumb components + useRecordingSetup hook as the Record page.
export function CapturePanel(): React.JSX.Element {
  const t = useTranslations("panel");
  const rootRef = useRef<HTMLDivElement>(null);
  const setup = useRecordingSetup();
  const shortcuts = useShortcutLabels();
  // Same source loading/default-selection as the Record page, so both windows
  // show the same screen instead of a hardcoded placeholder.
  useSourceSelection(setup);

  // The recording runs in another window, so this panel learns about it through
  // the global activity broadcast — it can't tell from its own (idle) recorder.
  const activity = useRecordingActivity();
  const isBusy = activity.active;
  const stopRecording = (): void => window.electronAPI?.controlCommand("stop");

  // Two modes: recording controls and the screenshot action. A recording locks the
  // tabs to Record — you can't switch mid-recording (screenshot-during-recording is a
  // future idea). `activeTab` forces Record while busy regardless of the last pick.
  const [tab, setTab] = useState<PanelTab>("record");
  const activeTab: PanelTab = isBusy ? "record" : tab;

  // The menu-bar icon mirrors this selection — it is often the only part of
  // Kaipu on screen, so it should say which mode a shortcut would start.
  // The panel calls the second tab "capture"; the brand calls that mark
  // "screenshot". Mapped here rather than renaming either vocabulary.
  useEffect(() => {
    window.electronAPI.setTrayMode(activeTab === "record" ? "record" : "screenshot");
  }, [activeTab]);

  // Keep the Electron window height matched to the content (mic menu, etc.).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      // getBoundingClientRect is fractional; ceil + a 1px cushion so the window
      // is never a hair shorter than the content (which would trip a scrollbar).
      const height = Math.ceil(el.getBoundingClientRect().height) + 1;
      window.electronAPI?.resizeCapturePanel(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const openMain = (): void => window.electronAPI?.openMainWindow();
  // "Change" from the tray: the picker + source enumeration live in the main renderer,
  // so open the main window and have its Record page open the source picker.
  const chooseSource = (): void => window.electronAPI?.requestChooseSource();
  // Start from the tray: open the main window and have its Record page start.
  const requestStart = (): void => window.electronAPI?.requestStartRecording();
  // Capture from the tray: main dismisses the panel and runs the interactive region
  // select (same flow as the ⌘⌃X hotkey), landing the user in the editor.
  const requestCapture = (): void => window.electronAPI?.requestCaptureScreenshot();

  return (
    <div ref={rootRef} className={styles.panel}>
      <PanelHeader onOpenMainWindow={openMain} />

      {/* Two modes: recording controls and the screenshot action. Locked to Record
          while a recording is in progress. */}
      <PanelTabs active={activeTab} onChange={setTab} disabled={isBusy} />

      {activeTab === "record" ? (
        <>
          {isBusy && (
            <RecordingIndicator
              variant="banner"
              paused={activity.status === "paused"}
              elapsedSeconds={activity.elapsedSeconds}
            />
          )}

          {/* While a recording is in progress its settings are locked — changing the
              source/mic mid-recording does nothing, so the controls go inert. */}
          <div
            className={styles.lockable}
            data-locked={isBusy || undefined}
            inert={isBusy || undefined}
          >
            <SourceCard source={setup.selectedSource} variant="compact" onChoose={chooseSource} />

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
              live there), not this transparent panel. While idle the button asks the
              main window to start; while recording it stops via the hub command. */}
          <RecordButton
            variant="compact"
            isRecording={isBusy}
            shortcut={shortcuts?.startRecording}
            onClick={isBusy ? stopRecording : requestStart}
          />
        </>
      ) : (
        // Screenshot mode: a single action that hands off to the native region select.
        <button type="button" className={styles.captureButton} onClick={requestCapture}>
          <span className={styles.captureLabel}>
            <Camera size={16} />
            {t("captureScreen")}
          </span>
          {shortcuts?.captureScreenshot && (
            <kbd className={styles.captureShortcut}>{shortcuts.captureScreenshot}</kbd>
          )}
        </button>
      )}
    </div>
  );
}
