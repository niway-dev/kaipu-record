import React, { useEffect, useRef, useState } from "react";
import { RecordingIndicator } from "@renderer/features/recording/components/recording-indicator";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { SourceCard } from "@renderer/features/recording/components/source-card";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { RecordButton } from "@renderer/features/recording/components/record-button";
import { RecordModeButtons } from "@renderer/features/recording/components/record-mode-buttons";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import { useRecordingMode } from "@renderer/features/recording/hooks/use-recording-mode";
import { CaptureModeButtons } from "@renderer/features/screenshots/capture-mode-buttons";
import {
  CameraPanelDrawer,
  CameraPanelTile,
  useCameraControl,
} from "@renderer/features/camera-settings";
import {
  MicPanelDrawer,
  MicToggleSplit,
  SystemAudioPanelDrawer,
  SystemAudioToggleSplit,
  useAudioControl,
  useAudioSettings,
} from "@renderer/features/audio-settings";
import { exclusive } from "@renderer/features/settings-controls/use-settings-disclosure";
import { PanelHeader } from "./components/panel-header";
import { PanelTabs, type PanelTab } from "./components/panel-tabs";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import styles from "./capture-panel.module.css";

// Compact composition of the recording controls, shown from the menu-bar tray.
// Reuses the same dumb components + useRecordingSetup hook as the Record page.
export function CapturePanel(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const setup = useRecordingSetup();
  const shortcuts = useShortcutLabels();
  // Same source loading/default-selection as the Record page, so both windows
  // show the same screen instead of a hardcoded placeholder.
  useSourceSelection(setup);
  const { area } = useRecordingSettings();
  const recordingMode = useRecordingMode(area);

  // The recording runs in another window, so this panel learns about it through
  // the global activity broadcast — it can't tell from its own (idle) recorder.
  const activity = useRecordingActivity();
  // A pending take (countdown) is busy too: no second selector while it counts.
  const isBusy = activity.active || activity.pending === true;
  // The split Mic, Audio and Camera tiles each share their state with an inline drawer;
  // only one drawer is open at a time (opening one closes the others).
  // One audio store for both audio tiles, so neither can write over the other's field.
  const audioStore = useAudioSettings();
  const [mic, systemAudio, camera] = exclusive([
    useAudioControl(audioStore),
    useAudioControl(audioStore),
    useCameraControl(),
  ]);
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

  const micSlot = (
    <MicToggleSplit
      compact
      control={mic}
      on={setup.isMicrophoneEnabled}
      onToggle={setup.toggleMicrophone}
    />
  );
  const audioSlot = (
    <SystemAudioToggleSplit
      compact
      control={systemAudio}
      on={setup.isSystemAudioEnabled}
      onToggle={setup.toggleSystemAudio}
      unavailable={isBusy && activity.systemAudioAvailable === false}
    />
  );
  const cameraSlot = (
    <CameraPanelTile control={camera} on={setup.isCameraEnabled} onToggle={setup.toggleCamera} />
  );
  // The drawers grow the panel downward; the ResizeObserver above follows them.
  const drawers = (
    <>
      <MicPanelDrawer
        control={mic}
        on={setup.isMicrophoneEnabled}
        isRecording={isBusy}
        microphones={setup.microphones}
        selectedMicrophone={setup.selectedMicrophone}
        onSelectMicrophone={setup.selectMicrophone}
      />
      <SystemAudioPanelDrawer control={systemAudio} micOn={setup.isMicrophoneEnabled} />
      <CameraPanelDrawer control={camera} on={setup.isCameraEnabled} isRecording={isBusy} />
    </>
  );

  const openMain = (): void => window.electronAPI?.openMainWindow();
  // "Change" from the tray: the picker + source enumeration live in the main renderer,
  // so open the main window and have its Record page open the source picker.
  const chooseSource = (): void => window.electronAPI?.requestChooseSource();
  // Start from the tray: main opens the selector (the capture overlay with the record
  // intent) in the last used mode, or straight in a chip's mode (design "Kaipu Record Modes").
  const openSelector = (mode?: CaptureMode): void =>
    window.electronAPI?.requestRecordSelector(mode);
  // Capture from the tray: main dismisses the panel and runs the chosen mode (same flow as
  // its global hotkey), landing the user in the editor.
  const requestCapture = (mode: CaptureMode): void =>
    window.electronAPI?.requestCaptureScreenshot(mode);

  return (
    <div ref={rootRef} className={styles.panel}>
      <PanelHeader onOpenMainWindow={openMain} />

      {/* Two modes: recording controls and the screenshot action. Locked to Record
          while a recording is in progress. */}
      <PanelTabs active={activeTab} onChange={setTab} disabled={isBusy} />

      {activeTab === "record" && !isBusy ? (
        <RecordModeButtons
          variant="panel"
          mode={recordingMode.mode}
          area={recordingMode.area}
          shortcut={shortcuts?.startRecording}
          onStart={() => openSelector()}
          onPick={openSelector}
        >
          <div className={styles.inputs}>
            <RecordingToggles
              variant="compact"
              isMicrophoneEnabled={setup.isMicrophoneEnabled}
              isSystemAudioEnabled={setup.isSystemAudioEnabled}
              isCameraEnabled={setup.isCameraEnabled}
              onToggleMicrophone={setup.toggleMicrophone}
              onToggleSystemAudio={setup.toggleSystemAudio}
              onToggleCamera={setup.toggleCamera}
              micSlot={micSlot}
              audioSlot={audioSlot}
              cameraSlot={cameraSlot}
            />
            {drawers}
          </div>
        </RecordModeButtons>
      ) : activeTab === "record" ? (
        <>
          {activity.active && (
            <RecordingIndicator
              variant="banner"
              paused={activity.status === "paused"}
              elapsedSeconds={activity.elapsedSeconds}
            />
          )}

          {/* Mid-take only the source stays locked (changing it would restart the encoder);
              the three toggles stay live — muting writes silence into the same track, the
              camera is captured as part of the screen — and the mic drawer locks its own
              device list. */}
          <div className={styles.lockable}>
            <div
              className={styles.locked}
              data-locked={isBusy || undefined}
              inert={isBusy || undefined}
            >
              <SourceCard source={setup.selectedSource} variant="compact" onChoose={chooseSource} />
            </div>

            <RecordingToggles
              variant="compact"
              isMicrophoneEnabled={setup.isMicrophoneEnabled}
              isSystemAudioEnabled={setup.isSystemAudioEnabled}
              isCameraEnabled={setup.isCameraEnabled}
              isSystemAudioUnavailable={isBusy && activity.systemAudioAvailable === false}
              onToggleMicrophone={setup.toggleMicrophone}
              onToggleSystemAudio={setup.toggleSystemAudio}
              onToggleCamera={setup.toggleCamera}
              micSlot={micSlot}
              audioSlot={audioSlot}
              cameraSlot={cameraSlot}
            />

            {drawers}
          </div>

          {/* Recording runs in the main window renderer (getDisplayMedia/WebCodecs
              live there), not this transparent panel: mid-take the button stops it via
              the hub command. */}
          <RecordButton
            variant="compact"
            isRecording
            shortcut={shortcuts?.stopRecording}
            onClick={stopRecording}
          />
        </>
      ) : (
        // Screenshot mode: the Capture button and the Frame, Window and Screen chips,
        // each handed off to main. `recording` stays wired for the day the tab lock above
        // lifts; today a recording forces the Record tab, so it is null here in practice.
        <CaptureModeButtons
          variant="panel"
          onCapture={requestCapture}
          shortcuts={shortcuts}
          recording={isBusy ? { elapsedSeconds: activity.elapsedSeconds } : null}
        />
      )}
    </div>
  );
}
