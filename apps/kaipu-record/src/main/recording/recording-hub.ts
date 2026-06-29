import { app, BrowserWindow, desktopCapturer, ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingFinalizeMeta,
  RecordingSettings,
  RecordingStartInfo,
  RecordingTick,
} from "@shared/types/ipc";
import { ControlBarWindow } from "./control-bar-window";
import { CameraBubbleWindow } from "./camera-bubble-window";
import { RecordingWriter, timestampId } from "./recording-writer";
import { IDLE_ACTIVITY, applyTick, startedActivity, stoppedActivity } from "./recording-activity";
import { vaultDirectory } from "../library/vault-location";
import {
  applyDockPolicy,
  forceRegularPolicy,
  getAppSettings,
} from "../infrastructure/settings-store";

/**
 * The single stateful coordinator for a recording. Owns the control-bar window
 * and relays between the (hidden) recorder window and the bar:
 *   recorder → report-tick → hub → control:tick → bar
 *   bar → control:command → hub → recording:command → recorder
 * It also hides/restores the main window so only the bar is visible while
 * recording, and registers the disk-writer IPC handlers.
 */
export function registerRecordingHub(getMainWindow: () => BrowserWindow | null): void {
  const bar = new ControlBarWindow();
  const cameraBubble = new CameraBubbleWindow();
  const writer = new RecordingWriter({
    vaultDir: () => vaultDirectory().path,
    newId: () => timestampId(Date.now()),
  });

  // Single source of truth for "is a recording happening", broadcast to every
  // window so non-recorder windows (reopened Record page, Capture Panel) can
  // reflect it and refuse to start a second recording. Transitions live in the
  // pure `recording-activity` module; the hub only owns the broadcast.
  let activity: RecordingActivity = IDLE_ACTIVITY;
  const broadcastActivity = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.recordingState, activity);
      }
    }
  };
  ipcMain.handle(IPC_CHANNELS.recordingGetState, (): RecordingActivity => activity);

  // Shared recording settings — single source of truth, mirrored to every window.
  const settings: RecordingSettings = {
    selectedSource: null,
    selectedMicrophone: null,
    isMicrophoneEnabled: true,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
  };
  const broadcastSettings = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.recordingSettingsChanged, settings);
      }
    }
  };
  ipcMain.handle(IPC_CHANNELS.recordingSettingsGet, (): RecordingSettings => settings);
  ipcMain.on(IPC_CHANNELS.recordingSettingsUpdate, (_e, patch: Partial<RecordingSettings>) => {
    const cameraWasOn = settings.isCameraEnabled;
    Object.assign(settings, patch);
    broadcastSettings();
    // The camera bubble follows the (now global) Camera toggle, so it works no
    // matter which window flipped it.
    if (settings.isCameraEnabled !== cameraWasOn) {
      if (settings.isCameraEnabled) {
        cameraBubble.show();
        // Showing a floating panel can drop the app from the Dock/Cmd+Tab on
        // macOS; re-assert the policy so the app stays reachable.
        applyDockPolicy();
      } else {
        // Destroy (not hide): the bubble holds the camera via getUserMedia, so
        // tearing down its window releases the device and turns the green
        // in-use light off. Hiding alone would keep the camera held.
        cameraBubble.destroy();
      }
    }
  });

  // ── Disk writer ──────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.recordingCreate, (_e, sessionId: string) => writer.create(sessionId));
  ipcMain.on(
    IPC_CHANNELS.recordingWrite,
    (_e, sessionId: string, data: ArrayBuffer, position: number) => {
      void writer.write(sessionId, data, position).catch((error) => {
        console.error("recording write failed", error);
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recordingFinalize,
    (_e, sessionId: string, meta: RecordingFinalizeMeta) => writer.finalize(sessionId, meta),
  );
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => writer.abort(sessionId));

  // ── Window orchestration ────────────────────────────────────────────
  ipcMain.on(IPC_CHANNELS.recordingStart, (_e, info: RecordingStartInfo) => {
    activity = startedActivity();
    getMainWindow()?.hide();
    // The main window is now hidden; force the app to stay in the Dock/Cmd+Tab so
    // it isn't lost while only the floating panels are visible. Restored on stop.
    forceRegularPolicy();
    broadcastActivity();
    // Place the bar on the screen being recorded (resolved from the source id).
    const includeInRecording = getAppSettings().showBarInRecording;
    void displayIdForSource(info.sourceId).then((displayId) =>
      bar.show(displayId, { includeInRecording }),
    );
  });
  ipcMain.on(IPC_CHANNELS.recordingStop, () => {
    activity = stoppedActivity(activity);
    bar.hide();
    const main = getMainWindow();
    main?.show();
    main?.focus();
    // Hiding the main window for the recording can drop the app from the Dock /
    // Cmd+Tab on macOS; re-assert the policy and bring the app forward so it's
    // back in the switcher (respects the "show in Dock" setting).
    applyDockPolicy();
    app.focus({ steal: true });
    broadcastActivity();
  });

  // ── Relay ────────────────────────────────────────────────────────────
  ipcMain.on(IPC_CHANNELS.recordingReportTick, (_e, tick: RecordingTick) => {
    bar.send(IPC_CHANNELS.controlTick, tick);
    const next = applyTick(activity, tick);
    activity = next.activity;
    if (next.changed) broadcastActivity();
  });
  ipcMain.on(IPC_CHANNELS.controlCommand, (_e, command: ControlCommand) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, command);
  });
}

/** Resolve which display a screen source belongs to (windows have none). */
async function displayIdForSource(sourceId: string): Promise<string | undefined> {
  if (!sourceId.startsWith("screen:")) return undefined;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.find((source) => source.id === sourceId)?.display_id || undefined;
  } catch {
    return undefined;
  }
}
