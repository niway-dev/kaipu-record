import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Pause, Play, Square } from "lucide-react";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useSourceSelection } from "@renderer/features/recording/hooks/use-source-selection";
import { usePermissions } from "@renderer/features/permissions";
import { RecordingToggles } from "@renderer/features/recording/components/recording-toggles";
import { RecordingIndicator } from "@renderer/features/recording/components/recording-indicator";
import { CountdownOverlay } from "@renderer/features/recording/components/countdown-overlay";
import { ScreenSourceSelector } from "@renderer/features/recording/components/screen-source-selector";
import { PermissionNotice } from "@renderer/features/recording/components/permission-notice";
import {
  CameraPanelPopover,
  CameraPanelTile,
  useCameraControl,
} from "@renderer/features/camera-settings";
import {
  MicPanelPopover,
  MicToggleSplit,
  SystemAudioPanelPopover,
  SystemAudioToggleSplit,
  useAudioControl,
  useAudioSettings,
} from "@renderer/features/audio-settings";
import { exclusive } from "@renderer/features/settings-controls/use-settings-disclosure";
import { useTranslations } from "@kaipu/i18n";
import { CaptureEntries, useCaptureEntryActions } from "@renderer/features/capture-entries";
import { ReconcileBanner } from "@renderer/features/library/reconcile/reconcile-banner";
import { useOptionalWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { WorkspaceNotConnectedNotice } from "@renderer/features/workspaces/not-connected-notice";
import styles from "./record-page.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** Navigation state main's requests leave on the Record page (see AppRoot). */
interface RecordNavState {
  startAt?: number;
  /** The overlay already ran the countdown: this start begins the take at once. */
  skipCountdown?: boolean;
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
  const navigate = useNavigate();
  const navState = (location.state as RecordNavState | null) ?? null;
  const shortcuts = useShortcutLabels();
  // Navigation to the finished recording's detail page happens at the app-shell
  // level (see AppShell), not here — the engine (and its completion) now
  // outlives this page's mount, so this page never needs to own that callback.
  const setup = useRecordingSetup();
  // One audio store for the Mic and Audio tiles: each write sends the whole `audio` object.
  const audioStore = useAudioSettings();
  const entries = useCaptureEntryActions();
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
      if (navState?.skipCountdown === true) startRecording({ skipCountdown: true });
      else startRecording();
      // The history entry keeps its state: Back to "/" after the take would remount this page
      // and replay the start (now with no countdown). Consume the request once it fired.
      const { startAt: _startAt, skipCountdown: _skipCountdown, ...rest } = navState ?? {};
      navigate(location, { replace: true, state: Object.keys(rest).length > 0 ? rest : null });
    }
  }, [navState, navigate, location, selectedSource, isRecording, startRecording]);

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

  // Anything but idle is busy (countdown, acquiring, recording, saving): the Mic and Camera
  // settings lock their device lists and the pre-take meter lets go of the device. Same
  // meaning as the capture panel's `isBusy`.
  const isBusy = setup.recordingStatus !== "idle";

  const isSystemAudioUnavailable = isRecording && activity.systemAudioAvailable === false;

  // Mic, Audio and Camera: setup cards in the row (name, current choice, switch, chevron), one
  // popover open at a time, anchored to its card and floating over the page (nothing moves).
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
            card
            ui={uiArea("record.mic")}
            selectedMicrophone={setup.selectedMicrophone}
            microphones={setup.microphones}
            control={mic}
            on={setup.isMicrophoneEnabled}
            onToggle={setup.toggleMicrophone}
          />
        }
        audioSlot={
          <SystemAudioToggleSplit
            card
            ui={uiArea("record.audio")}
            control={systemAudio}
            on={setup.isSystemAudioEnabled}
            onToggle={setup.toggleSystemAudio}
            unavailable={isSystemAudioUnavailable}
          />
        }
        cameraSlot={
          <CameraPanelTile
            card
            ui={uiArea("record.camera")}
            compact={false}
            control={camera}
            on={setup.isCameraEnabled}
            onToggle={setup.toggleCamera}
          />
        }
      />
      <MicPanelPopover
        ui={uiArea("record.micPopover")}
        control={mic}
        on={setup.isMicrophoneEnabled}
        isRecording={isBusy}
        microphones={setup.microphones}
        selectedMicrophone={setup.selectedMicrophone}
        onSelectMicrophone={setup.selectMicrophone}
      />
      <SystemAudioPanelPopover
        ui={uiArea("record.audioPopover")}
        control={systemAudio}
        micOn={setup.isMicrophoneEnabled}
      />
      <CameraPanelPopover
        ui={uiArea("record.cameraPopover")}
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
          ui={uiArea("record.micNotice")}
          label={t("micAccessOff")}
          onOpenSettings={() => void openPermissionSettings("microphone")}
        />
      )}

      {setup.isCameraEnabled && isCameraDenied && (
        <PermissionNotice
          ui={uiArea("record.cameraNotice")}
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
        <CountdownOverlay
          ui={uiArea("record.countdown")}
          value={setup.countdown}
          onCancel={setup.stopRecording}
        />
      )}
    </>
  );

  // Design "Kaipu Capture Home": one page in every state. Two entries that open the selector
  // (the capture widget), then what is set once: the sound and camera inputs. What to capture
  // is picked in the selector, so the page has no Start button and no source card. While a
  // take runs the same page stays, with the recording bar under the header and the entries
  // disabled; the setup row stays live.
  return (
    <div {...uiArea("record.page")} className={styles.idlePage}>
      <WorkspaceNotConnectedNotice ui={uiArea("record.workspaceNotice")} />
      <div className={styles.idleHeading}>
        <h1 className={styles.idleTitle}>{t("capturePageTitle")}</h1>
        <span className={styles.idleWorkspace}>
          {t("capturePageWorkspace", { name: workspaces?.active?.name ?? "…" })}
        </span>
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

      {isRecording && (
        <RecordingIndicator
          ui={uiArea("record.recordingIndicator")}
          paused={isPaused}
          elapsedSeconds={activity.elapsedSeconds}
          sourceName={selectedSource?.name}
        >
          <div {...uiArea("record.recordingControls")} className={styles.recordingControls}>
            {isPaused ? (
              <button className={styles.pauseButton} type="button" onClick={setup.resumeRecording}>
                <Play size={14} fill="currentColor" />
                {t("resume")}
              </button>
            ) : (
              <button className={styles.pauseButton} type="button" onClick={setup.pauseRecording}>
                <Pause size={14} />
                {t("pause")}
              </button>
            )}
            <button className={styles.stopButton} type="button" onClick={setup.stopRecording}>
              <Square size={12} fill="currentColor" />
              {t("stopRecording")}
            </button>
          </div>
        </RecordingIndicator>
      )}

      <ReconcileBanner ui={uiArea("record.reconcileBanner")} />

      <CaptureEntries
        variant="card"
        shortcuts={shortcuts}
        screenshotLastUsed={entries.screenshotLastUsed}
        recordingLastUsed={entries.recordingLastUsed}
        onScreenshot={entries.openScreenshot}
        onRecording={entries.openRecording}
        screenshotUi={uiArea("record.screenshotCard")}
        recordingUi={uiArea("record.recordingCard")}
        instantUi={uiArea("record.instantLine")}
        disabled={isRecording}
      />

      <section {...uiArea("record.setup")} className={styles.setup}>
        <div className={styles.setupHeading}>
          <h2 className={styles.setupTitle}>{t("setupTitle")}</h2>
          <p className={styles.setupHint}>{t("setupHint")}</p>
        </div>
        <div className={styles.setupBody}>
          {toggles}
          {inputNotices}
        </div>
      </section>

      {pickerAndCountdown}
    </div>
  );
}
