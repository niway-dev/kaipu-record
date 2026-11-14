import React, { useEffect, useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import { useRecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";
import { useRecordingActivity } from "@renderer/features/recording/hooks/use-recording-activity";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { CaptureEntries, useCaptureEntryActions } from "@renderer/features/capture-entries";
import { PanelHeader } from "./components/panel-header";
import { PanelSwitches } from "./components/panel-switches";
import { PanelFooter } from "./components/panel-footer";
import { RecordingStatus, StopButton } from "./components/panel-recording";
import { useActiveWorkspace } from "./use-active-workspace";
import styles from "./capture-panel.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/**
 * The menu-bar popover: the two capture entries and the three input switches while idle, and
 * the status, Stop and the same switches (read-only) while a take runs. It sets nothing up:
 * sources, devices and their settings live on the Capture page, one click away ("Setup").
 */
export function CapturePanel(): React.JSX.Element {
  const t = useTranslations("panel");
  const rootRef = useRef<HTMLDivElement>(null);
  // Shared with the Capture page through main: flipping a switch here flips it there.
  const setup = useRecordingSetup();
  const shortcuts = useShortcutLabels();
  const entries = useCaptureEntryActions();
  const workspace = useActiveWorkspace();

  // The recording runs in another window, so this panel learns about it through
  // the global activity broadcast — it can't tell from its own (idle) recorder.
  const activity = useRecordingActivity();
  // A pending take (countdown) is busy too: no second selector while it counts.
  const isBusy = activity.active || activity.pending === true;

  // Keep the Electron window height matched to the content.
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

  return (
    <div
      {...uiArea("capturePanel.root")}
      ref={rootRef}
      className={styles.panel}
      data-testid="capture-panel"
    >
      <PanelHeader onOpenMainWindow={() => window.electronAPI?.openMainWindow()} />

      {isBusy ? (
        <>
          <RecordingStatus
            starting={!activity.active}
            paused={activity.status === "paused"}
            mode={entries.recordingModeName}
            elapsedSeconds={activity.elapsedSeconds}
          />
          {/* Recording runs in the main window renderer (getDisplayMedia/WebCodecs live
              there), not this transparent panel: Stop goes through the hub command. */}
          <StopButton
            shortcut={shortcuts?.startRecording}
            onStop={() => window.electronAPI?.controlCommand("stop")}
          />
        </>
      ) : (
        <div {...uiArea("capturePanel.entries")}>
          <CaptureEntries
            variant="row"
            shortcuts={shortcuts}
            onScreenshot={entries.openScreenshot}
            onRecording={entries.openRecording}
          />
        </div>
      )}

      <div className={styles.sectionLabel}>{isBusy ? t("recordingWith") : t("recordWith")}</div>
      <PanelSwitches
        isMicrophoneEnabled={setup.isMicrophoneEnabled}
        isSystemAudioEnabled={setup.isSystemAudioEnabled}
        isCameraEnabled={setup.isCameraEnabled}
        locked={isBusy}
        onToggleMicrophone={setup.toggleMicrophone}
        onToggleSystemAudio={setup.toggleSystemAudio}
        onToggleCamera={setup.toggleCamera}
      />
      {isBusy && <p className={styles.lockedNote}>{t("lockedNote")}</p>}

      <PanelFooter
        workspace={workspace}
        onOpenWorkspace={() => window.electronAPI?.openMainWindow()}
        onOpenSetup={() => window.electronAPI?.openCaptureSetup()}
      />
    </div>
  );
}
