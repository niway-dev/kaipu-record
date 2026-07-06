import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Pause, Play, Square } from "lucide-react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { usePermissions } from "@renderer/features/permissions";
import { SourceCard } from "@renderer/features/recording/components/source-card";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { MicPicker } from "@renderer/features/recording/components/mic-picker";
import { RecordButton } from "@renderer/features/recording/components/record-button";
import { RecordingIndicator } from "@renderer/features/recording/components/recording-indicator";
import { CountdownOverlay } from "@renderer/features/recording/components/countdown-overlay";
import { ScreenSourceSelector } from "@renderer/features/recording/components/screen-source-selector";
import { PermissionNotice } from "@renderer/features/recording/components/permission-notice";
import { useTranslations } from "@kaipu/i18n";
import styles from "./record-page.module.css";

// Composition only. State lives in the hooks; this wires them to dumb components.
export function RecordPage(): React.JSX.Element {
  const t = useTranslations("record");
  const location = useLocation();
  const shortcuts = useShortcutLabels();
  // Navigation to the finished recording's detail page happens at the app-shell
  // level (see AppShell), not here — the engine (and its completion) now
  // outlives this page's mount, so this page never needs to own that callback.
  const setup = useRecordingSetup();
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

  // A global "start" (hotkey or Capture Panel) navigates here with a `startAt`
  // flag (see AppShell). Auto-start once per flag, after a source is ready and
  // we're not already recording. `startedForRef` makes it fire exactly once.
  const startedForRef = useRef<number | null>(null);
  useEffect(() => {
    const startAt = (location.state as { startAt?: number } | null)?.startAt;
    if (startAt && startedForRef.current !== startAt && selectedSource && !isRecording) {
      startedForRef.current = startAt;
      startRecording();
    }
  }, [location.state, selectedSource, isRecording, startRecording]);

  // The Capture Panel's "Change" navigates here with an `openPicker` flag (see
  // AppShell) — open the source picker once per flag. `openSourcePicker` isn't
  // memoized, so read it through a ref and key the effect only on the nav state.
  const openPickerRef = useRef(setup.openSourcePicker);
  openPickerRef.current = setup.openSourcePicker;
  const pickerForRef = useRef<number | null>(null);
  useEffect(() => {
    const openPicker = (location.state as { openPicker?: number } | null)?.openPicker;
    if (openPicker && pickerForRef.current !== openPicker) {
      pickerForRef.current = openPicker;
      openPickerRef.current();
    }
  }, [location.state]);

  const isPaused = isRecording && activity.status === "paused";
  // The gap between the countdown ending and the window handing off to the bar:
  // streams are acquiring, isRecording is still false. Keep the overlay up.
  const isStarting = setup.recordingStatus === "starting";

  return (
    <div className={styles.page}>
      {isRecording ? (
        <RecordingIndicator
          variant="bar"
          paused={isPaused}
          elapsedSeconds={activity.elapsedSeconds}
        />
      ) : (
        <div className={styles.heading}>
          <span className={styles.headingDot} />
          <h1 className={styles.headingTitle}>{t("readyToRecord")}</h1>
        </div>
      )}

      <div
        className={styles.lockable}
        data-locked={isRecording || undefined}
        inert={isRecording || undefined}
      >
        <SourceCard
          source={setup.selectedSource}
          locked={isRecording}
          onChoose={setup.openSourcePicker}
        />

        <RecordingToggles
          isMicrophoneEnabled={setup.isMicrophoneEnabled}
          isSystemAudioEnabled={setup.isSystemAudioEnabled}
          isCameraEnabled={setup.isCameraEnabled}
          onToggleMicrophone={setup.toggleMicrophone}
          onToggleSystemAudio={setup.toggleSystemAudio}
          onToggleCamera={setup.toggleCamera}
        />

        {setup.isMicrophoneEnabled &&
          (isMicrophoneDenied ? (
            <PermissionNotice
              label={t("micAccessOff")}
              onOpenSettings={() => void openPermissionSettings("microphone")}
            />
          ) : (
            setup.microphones.length > 0 && (
              <MicPicker
                microphones={setup.microphones}
                selected={setup.selectedMicrophone}
                isOpen={setup.isMicrophoneMenuOpen}
                onToggle={setup.toggleMicrophoneMenu}
                onSelect={setup.selectMicrophone}
              />
            )
          ))}

        {setup.isCameraEnabled && isCameraDenied && (
          <PermissionNotice
            label={t("cameraAccessOff")}
            onOpenSettings={() => void openPermissionSettings("camera")}
          />
        )}
      </div>

      {isRecording ? (
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
      ) : (
        <RecordButton
          isRecording={false}
          disabled={!setup.canStartRecording}
          shortcut={shortcuts?.startRecording}
          onClick={setup.startRecording}
        />
      )}

      {isRecording && <p className={styles.recordingHint}>{t("stopHint")}</p>}

      <ScreenSourceSelector
        isOpen={setup.isSourcePickerOpen}
        sources={sources}
        isLoading={isLoadingSources}
        error={sourcesError}
        isAccessGranted={!permissionsChecked || permissionStatus.screen}
        currentSourceId={setup.selectedSource?.id}
        onClose={setup.closeSourcePicker}
        onSelectSource={(source) => {
          setup.selectSource({ id: source.id, name: source.name, type: source.type });
          setup.closeSourcePicker();
        }}
        onGrantAccess={() => void openPermissionSettings("screen")}
      />

      {(setup.countdown !== null || isStarting) && (
        <CountdownOverlay value={setup.countdown} onCancel={setup.stopRecording} />
      )}
    </div>
  );
}
