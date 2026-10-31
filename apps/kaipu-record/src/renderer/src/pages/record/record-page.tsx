import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Pause, Play, Square } from "lucide-react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { useRecordingSettings } from "@renderer/features/recording/hooks/use-recording-settings";
import { useRecordingMode } from "@renderer/features/recording/hooks/use-recording-mode";
import { usePermissions } from "@renderer/features/permissions";
import { SourceCard } from "@renderer/features/recording/components/source-card";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { RecordModeButtons } from "@renderer/features/recording/components/record-mode-buttons";
import { RecordingIndicator } from "@renderer/features/recording/components/recording-indicator";
import { CountdownOverlay } from "@renderer/features/recording/components/countdown-overlay";
import { ScreenSourceSelector } from "@renderer/features/recording/components/screen-source-selector";
import { PermissionNotice } from "@renderer/features/recording/components/permission-notice";
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
import { useTranslations } from "@kaipu/i18n";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { useOptionalWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { WorkspaceNotConnectedNotice } from "@renderer/features/workspaces/not-connected-notice";
import styles from "./record-page.module.css";

/** Navigation state main's requests leave on the Record page (see AppRoot). */
interface RecordNavState {
  startAt?: number;
  openPicker?: number;
  /** The picker was opened as the Window mode of "Start recording": a pick starts. */
  startOnPick?: boolean;
}

// Composition only. State lives in the hooks; this wires them to dumb components.
export function RecordPage(): React.JSX.Element {
  const t = useTranslations("record");
  // Where this take lands (spec decision 13): named in the heading, switchable from it.
  const workspaces = useOptionalWorkspaces();
  const location = useLocation();
  const navState = (location.state as RecordNavState | null) ?? null;
  const shortcuts = useShortcutLabels();
  // Navigation to the finished recording's detail page happens at the app-shell
  // level (see AppShell), not here — the engine (and its completion) now
  // outlives this page's mount, so this page never needs to own that callback.
  const setup = useRecordingSetup();
  // One audio store for the Mic and Audio tiles: each write sends the whole `audio` object.
  const audioStore = useAudioSettings();
  const { area } = useRecordingSettings();
  const recordingMode = useRecordingMode(area);
  const { sources, isLoading: isLoadingSources, error: sourcesError } = useSourceSelection(setup);
  const {
    status: permissionStatus,
    check: recheckPermissions,
    openSettings: openPermissionSettings,
  } = usePermissions();
  const [permissionsChecked, setPermissionsChecked] = useState(false);

  // Mark when the first permission read resolves, so we never flash a "denied"
  // notice before we actually know the status.
  useEffect(() => {
    void recheckPermissions().then(() => setPermissionsChecked(true));
  }, [recheckPermissions]);

  const isMicrophoneDenied = permissionsChecked && !permissionStatus.microphone;
  const isCameraDenied = permissionsChecked && !permissionStatus.camera;

  // Recording runs in this window; reflect it in the heading and lock the
  // setup controls so the user can't fiddle with (or re-trigger) it mid-record.
  const activity = useRecordingActivity();
  const { startRecording, selectedSource, isRecording } = setup;

  // A global "start" (the overlay's Record, after it set the target) navigates here with a
  // `startAt` flag (see AppRoot). Auto-start once per flag, after a source is ready and
  // we're not already recording. `startedForRef` makes it fire exactly once.
  const startedForRef = useRef<number | null>(null);
  useEffect(() => {
    const startAt = navState?.startAt;
    if (startAt && startedForRef.current !== startAt && selectedSource && !isRecording) {
      startedForRef.current = startAt;
      startRecording();
    }
  }, [navState?.startAt, selectedSource, isRecording, startRecording]);

  // The tray's "Change", or Window from "Start recording", navigates here with an
  // `openPicker` flag (see AppRoot) — open the source picker once per flag. Opened as the
  // Window mode, the pick starts the countdown. `openSourcePicker` isn't memoized, so read
  // it through a ref and key the effect only on the nav state.
  const openPickerRef = useRef(setup.openSourcePicker);
  openPickerRef.current = setup.openSourcePicker;
  const pickerForRef = useRef<number | null>(null);
  const startOnPickRef = useRef(false);
  // A pick made to record starts once the chosen source is the selected one (the settings
  // write round-trips through main), so the take never starts on the previous source.
  const [pendingStartId, setPendingStartId] = useState<string | null>(null);
  useEffect(() => {
    const openPicker = navState?.openPicker;
    if (openPicker && pickerForRef.current !== openPicker) {
      pickerForRef.current = openPicker;
      startOnPickRef.current = navState?.startOnPick === true;
      // A pick whose selection never landed (a failed settings write) must not fire later.
      setPendingStartId(null);
      openPickerRef.current();
    }
  }, [navState?.openPicker, navState?.startOnPick]);

  useEffect(() => {
    if (!pendingStartId || selectedSource?.id !== pendingStartId || isRecording) return;
    setPendingStartId(null);
    startRecording();
  }, [pendingStartId, selectedSource, isRecording, startRecording]);

  const isPaused = isRecording && activity.status === "paused";
  // The gap between the countdown ending and the window handing off to the bar:
  // streams are acquiring, isRecording is still false. Keep the overlay up.
  const isStarting = setup.recordingStatus === "starting";

  const openSelector = (mode?: CaptureMode): void => window.electronAPI.requestRecordSelector(mode);

  // Anything but idle is busy (countdown, acquiring, recording, saving): the Mic and Camera
  // settings lock their device lists and the pre-take meter lets go of the device. Same
  // meaning as the capture panel's `isBusy`.
  const isBusy = setup.recordingStatus !== "idle";

  const isSystemAudioUnavailable = isRecording && activity.systemAudioAvailable === false;

  // Mic, Audio and Camera: split tiles in the row, one inline drawer open at a time, right
  // under the row in the page's flow (the content area scrolls, so a tall drawer pushes
  // instead of being clipped). Same pattern as the capture panel, with the wide variant.
  const [mic, systemAudio, camera] = exclusive([
    useAudioControl(audioStore),
    useAudioControl(audioStore),
    useCameraControl(),
  ]);

  const toggles = (
    <>
      <RecordingToggles
        isMicrophoneEnabled={setup.isMicrophoneEnabled}
        isSystemAudioEnabled={setup.isSystemAudioEnabled}
        isCameraEnabled={setup.isCameraEnabled}
        isSystemAudioUnavailable={isSystemAudioUnavailable}
        onToggleMicrophone={setup.toggleMicrophone}
        onToggleSystemAudio={setup.toggleSystemAudio}
        onToggleCamera={setup.toggleCamera}
        micSlot={
          <MicToggleSplit
            control={mic}
            on={setup.isMicrophoneEnabled}
            onToggle={setup.toggleMicrophone}
          />
        }
        audioSlot={
          <SystemAudioToggleSplit
            control={systemAudio}
            on={setup.isSystemAudioEnabled}
            onToggle={setup.toggleSystemAudio}
            unavailable={isSystemAudioUnavailable}
          />
        }
        cameraSlot={
          <CameraPanelTile
            compact={false}
            control={camera}
            on={setup.isCameraEnabled}
            onToggle={setup.toggleCamera}
          />
        }
      />
      <MicPanelDrawer
        variant="page"
        control={mic}
        on={setup.isMicrophoneEnabled}
        isRecording={isBusy}
        microphones={setup.microphones}
        selectedMicrophone={setup.selectedMicrophone}
        onSelectMicrophone={setup.selectMicrophone}
      />
      <SystemAudioPanelDrawer
        variant="page"
        control={systemAudio}
        micOn={setup.isMicrophoneEnabled}
      />
      <CameraPanelDrawer
        variant="page"
        control={camera}
        on={setup.isCameraEnabled}
        isRecording={isBusy}
      />
    </>
  );

  const inputNotices = (
    <>
      {setup.isMicrophoneEnabled && isMicrophoneDenied && (
        <PermissionNotice
          label={t("micAccessOff")}
          onOpenSettings={() => void openPermissionSettings("microphone")}
        />
      )}

      {setup.isCameraEnabled && isCameraDenied && (
        <PermissionNotice
          label={t("cameraAccessOff")}
          onOpenSettings={() => void openPermissionSettings("camera")}
        />
      )}
    </>
  );

  const pickerAndCountdown = (
    <>
      <ScreenSourceSelector
        isOpen={setup.isSourcePickerOpen}
        sources={sources}
        isLoading={isLoadingSources}
        error={sourcesError}
        isAccessGranted={!permissionsChecked || permissionStatus.screen}
        currentSourceId={setup.selectedSource?.id}
        onClose={() => {
          startOnPickRef.current = false;
          setup.closeSourcePicker();
        }}
        onSelectSource={(source) => {
          setup.selectSource({ id: source.id, name: source.name, type: source.type });
          setup.closeSourcePicker();
          if (startOnPickRef.current) {
            startOnPickRef.current = false;
            setPendingStartId(source.id);
          }
        }}
        onGrantAccess={() => void openPermissionSettings("screen")}
      />

      {(setup.countdown !== null || isStarting) && (
        <CountdownOverlay value={setup.countdown} onCancel={setup.stopRecording} />
      )}
    </>
  );

  if (!isRecording) {
    // Design "Kaipu Record Modes": what to record is picked in the selector (the capture
    // overlay), so the page is Start, the last used mode, and the sound and camera inputs.
    return (
      <div className={styles.idlePage}>
        <WorkspaceNotConnectedNotice />
        <p className={styles.eyebrow}>{t("eyebrow")}</p>
        <div className={styles.idleHeading}>
          <h1 className={styles.idleTitle}>
            {t("recordingTo", { name: workspaces?.active?.name ?? "…" })}
          </h1>
          {workspaces?.active && (
            <button
              type="button"
              className={styles.switchWorkspace}
              onClick={() => workspaces.setMenuOpen(true)}
            >
              {t("switchWorkspace")}
            </button>
          )}
        </div>
        <p className={styles.subtitle}>{t("subtitle")}</p>

        <RecordModeButtons
          variant="page"
          mode={recordingMode.mode}
          area={recordingMode.area}
          shortcut={shortcuts?.startRecording}
          onStart={() => openSelector()}
          onPick={openSelector}
        >
          <div className={styles.cardDivider} />
          <p className={styles.sectionLabel}>{t("soundAndCamera")}</p>
          <div className={styles.lockable}>
            {toggles}
            {inputNotices}
          </div>
        </RecordModeButtons>

        {pickerAndCountdown}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <RecordingIndicator
        variant="bar"
        paused={isPaused}
        elapsedSeconds={activity.elapsedSeconds}
      />

      <div className={styles.lockable}>
        <div className={styles.locked} data-locked inert>
          <SourceCard source={setup.selectedSource} locked onChoose={setup.openSourcePicker} />
        </div>
        {toggles}
        {inputNotices}
      </div>

      <div className={styles.recordingControls}>
        {isPaused ? (
          <button className={styles.pauseButton} type="button" onClick={setup.resumeRecording}>
            <Play size={15} fill="currentColor" />
            {t("resume")}
          </button>
        ) : (
          <button className={styles.pauseButton} type="button" onClick={setup.pauseRecording}>
            <Pause size={15} />
            {t("pause")}
          </button>
        )}
        <button className={styles.stopButton} type="button" onClick={setup.stopRecording}>
          <Square size={13} fill="currentColor" />
          {t("stopRecording")}
        </button>
      </div>

      <p className={styles.recordingHint}>{t("stopHint")}</p>
      {pickerAndCountdown}
    </div>
  );
}
