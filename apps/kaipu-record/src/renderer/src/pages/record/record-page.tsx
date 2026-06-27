import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pause, Play, Square } from "lucide-react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
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
import styles from "./record-page.module.css";

// Composition only. State lives in the hooks; this wires them to dumb components.
export function RecordPage(): React.JSX.Element {
  const navigate = useNavigate();
  // After a recording saves, jump straight to its detail page to see the output.
  const setup = useRecordingSetup({
    onRecordingComplete: (recording) => navigate(`/library/${recording.id}`),
  });
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

  // The live camera now lives in its own floating bubble window (captured into the
  // recording). Drive it from the Camera toggle; hide it when leaving the page.
  useEffect(() => {
    window.electronAPI.setCameraBubble(setup.isCameraEnabled && !isCameraDenied);
  }, [setup.isCameraEnabled, isCameraDenied]);
  useEffect(() => () => window.electronAPI.setCameraBubble(false), []);

  // A "Start" from the Capture Panel runs our normal start here (countdown + record).
  // Read the latest handler through a ref so the listener never goes stale.
  const startRef = useRef(setup.startRecording);
  startRef.current = setup.startRecording;
  useEffect(() => window.electronAPI.onRequestStartRecording(() => startRef.current()), []);

  // Recording runs in this window; reflect it in the heading and lock the
  // setup controls so the user can't fiddle with (or re-trigger) it mid-record.
  const activity = useRecordingActivity();
  const isRecording = setup.isRecording;
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
          <h1 className={styles.headingTitle}>Ready to record</h1>
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
              label="Microphone access is off"
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
            label="Camera access is off"
            onOpenSettings={() => void openPermissionSettings("camera")}
          />
        )}
      </div>

      {isRecording ? (
        <div className={styles.recordingControls}>
          {isPaused ? (
            <button className={styles.pauseButton} type="button" onClick={setup.resumeRecording}>
              <Play size={15} fill="currentColor" />
              Resume
            </button>
          ) : (
            <button className={styles.pauseButton} type="button" onClick={setup.pauseRecording}>
              <Pause size={15} />
              Pause
            </button>
          )}
          <button className={styles.stopButton} type="button" onClick={setup.stopRecording}>
            <Square size={13} fill="currentColor" />
            Stop recording
          </button>
        </div>
      ) : (
        <RecordButton
          isRecording={false}
          disabled={!setup.canStartRecording || isStarting || setup.countdown !== null}
          shortcut="⌘⇧P"
          onClick={setup.startRecording}
        />
      )}

      {isRecording && <p className={styles.recordingHint}>Stop from here or the floating bar</p>}

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

      {(setup.countdown !== null || isStarting) && <CountdownOverlay value={setup.countdown} />}
    </div>
  );
}
