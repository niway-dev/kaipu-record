import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pause, Play, Square } from "lucide-react";
import { formatElapsed } from "@renderer/features/recording/elapsed";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { useCameraPreview } from "@renderer/features/recording/hooks/use-camera-preview";
import { usePermissions } from "@renderer/features/onboarding/use-permissions";
import { SourceCard } from "@renderer/features/recording/components/source-card";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { MicPicker } from "@renderer/features/recording/components/mic-picker";
import { WebcamPreview } from "@renderer/features/recording/components/webcam-preview";
import { RecordButton } from "@renderer/features/recording/components/record-button";
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
  const camera = useCameraPreview(setup.isCameraEnabled);
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
  const isRecording = setup.isRecording;
  const isPaused = isRecording && activity.status === "paused";
  const timer = formatElapsed(activity.elapsedSeconds * 1000);

  return (
    <div className={styles.page}>
      {isRecording ? (
        <div className={styles.recordingBar} data-paused={isPaused || undefined}>
          <span className={styles.recordingDot} data-paused={isPaused || undefined} />
          <span className={styles.recordingLabel}>{isPaused ? "Paused" : "Recording"}</span>
          <span className={styles.recordingTimer}>{timer}</span>
        </div>
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

        {setup.isCameraEnabled &&
          (isCameraDenied ? (
            <PermissionNotice
              label="Camera access is off"
              onOpenSettings={() => void openPermissionSettings("camera")}
            />
          ) : (
            <WebcamPreview videoRef={camera.videoRef} hasStream={camera.hasStream} />
          ))}
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
          disabled={!setup.canStartRecording}
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

      {setup.countdown !== null && <CountdownOverlay value={setup.countdown} />}
    </div>
  );
}
