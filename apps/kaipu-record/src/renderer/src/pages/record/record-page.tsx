import React, { useEffect, useState } from "react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useScreenSources } from "@renderer/features/recording/hooks/use-screen-sources";
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
  const setup = useRecordingSetup();
  const {
    sources,
    isLoading: isLoadingSources,
    error: sourcesError,
    refresh: refreshSources,
  } = useScreenSources();
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

  // Refresh the source list whenever the picker opens.
  useEffect(() => {
    if (setup.isSourcePickerOpen) void refreshSources();
  }, [setup.isSourcePickerOpen, refreshSources]);

  const isMicrophoneDenied = permissionsChecked && !permissionStatus.microphone;
  const isCameraDenied = permissionsChecked && !permissionStatus.camera;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <span className={styles.headingDot} />
        <h1 className={styles.headingTitle}>Ready to record</h1>
      </div>

      <SourceCard source={setup.selectedSource} onChoose={setup.openSourcePicker} />

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

      <RecordButton
        isRecording={setup.isRecording}
        disabled={!setup.canStartRecording}
        shortcut="⌘⇧P"
        onClick={setup.isRecording ? setup.stopRecording : setup.startRecording}
      />

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
