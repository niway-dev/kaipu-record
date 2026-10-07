import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingFinalizeMeta,
  RecordingSettings,
  RecordingStartInfo,
  RecordingTick,
} from "@shared/types/ipc";
import { serializeCursorTrack } from "@shared/cursor-track";
import { LibraryVault } from "../library/library-vault";
import { pickCapturedDisplay } from "./captured-display";
import { ClickHook, type HookLike } from "./click-hook";
import { CursorTrackRegistry } from "./cursor-tracker";
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

/** The three input toggles a global shortcut can flip. */
export type LiveRecordingToggle =
  | "isMicrophoneEnabled"
  | "isSystemAudioEnabled"
  | "isCameraEnabled";

export interface RecordingHubHandle {
  /** True while a recording is active or paused. */
  isActive(): boolean;
  /**
   * Flip one of the three input toggles, exactly as clicking it in a window
   * does (the global shortcuts use this). Mid-take the recorder picks the
   * change up from the settings broadcast; outside a take it is just the
   * pre-recording setting.
   */
  toggleRecordingSetting(key: LiveRecordingToggle): void;
  /**
   * Hide the camera bubble for the duration of a screenshot capture (it sits
   * always-on-top, so it would otherwise land in the shot) without releasing
   * the camera device. No-ops if the bubble isn't currently shown.
   */
  hideCameraBubbleForCapture(): void;
  /** Restore the bubble after a capture, but only if it was actually hidden
   *  for it AND the camera toggle is still on (it may have been turned off
   *  mid-capture). */
  restoreCameraBubbleAfterCapture(): void;
  /**
   * Best-effort recovery when the recorder renderer is gone (crash, or the
   * main window destroyed) mid-recording: resets activity, hides the bar, and
   * restores the Dock policy without waiting on IPC that will never arrive
   * from a dead renderer. No-ops while idle.
   */
  forceReset(): void;
}

/**
 * The single stateful coordinator for a recording. Owns the control-bar window
 * and relays between the (hidden) recorder window and the bar:
 *   recorder → report-tick → hub → control:tick → bar
 *   bar → control:command → hub → recording:command → recorder
 * It also hides/restores the main window so only the bar is visible while
 * recording, and registers the disk-writer IPC handlers.
 */
export function registerRecordingHub(
  getMainWindow: () => BrowserWindow | null,
): RecordingHubHandle {
  const bar = new ControlBarWindow();
  const cameraBubble = new CameraBubbleWindow();
  const writer = new RecordingWriter({
    vaultDir: () => vaultDirectory().path,
    newId: () => timestampId(Date.now()),
  });

  // Cursor tracks, keyed by writer session id (see plans/video-editor-v2/02).
  const cursorTracks = new CursorTrackRegistry({
    now: () => performance.now(),
    cursorPoint: () => screen.getCursorScreenPoint(),
    every: (ms, fn) => {
      const handle = setInterval(fn, ms);
      return () => clearInterval(handle);
    },
  });
  // Mouse-down only, and only while a recording samples (see plans/video-editor-v2/03).
  const clickHook = new ClickHook(
    {
      platform: process.platform,
      // `false` = check only. Passing true here would show the macOS prompt mid-recording.
      isAccessibilityTrusted: () =>
        process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(false),
      load: () => {
        try {
          // Lazy require: a broken/missing native binary must not crash main at startup.
          return (require("uiohook-napi") as { uIOhook: HookLike }).uIOhook;
        } catch (error) {
          console.warn("uiohook-napi failed to load", error);
          return null;
        }
      },
    },
    (button) => {
      for (const tracker of cursorTracks.all()) tracker.addClick(button);
    },
  );
  // Sessions whose whole recording had the hook running.
  const clickSessions = new Set<string>();
  const stopHookIfIdle = (): void => {
    if (!cursorTracks.active) clickHook.stop();
  };

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
  const applySettingsPatch = (patch: Partial<RecordingSettings>): void => {
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
  };
  ipcMain.on(IPC_CHANNELS.recordingSettingsUpdate, (_e, patch: Partial<RecordingSettings>) => {
    applySettingsPatch(patch);
  });

  // ── Disk writer ──────────────────────────────────────────────────────
  // Whether we've already told the renderer to stop for a failed write, so the
  // "stop" is sent once per recording (writes are fire-and-forget and keep
  // arriving after the first failure). Reset on each new session.
  let stoppedForWriteFailure = false;
  ipcMain.handle(IPC_CHANNELS.recordingCreate, (_e, sessionId: string) => {
    stoppedForWriteFailure = false;
    return writer.create(sessionId);
  });
  ipcMain.on(
    IPC_CHANNELS.recordingWrite,
    (_e, sessionId: string, data: ArrayBuffer, position: number) => {
      void writer.write(sessionId, data, position).catch((error) => {
        console.error("recording write failed", error);
        // Writes are fire-and-forget, so without this the engine keeps encoding
        // and the bar keeps ticking while every chunk is dropped. Stop the
        // recorder promptly on the first failure: its stop runs finalize, which
        // now refuses success on a failed session → the user gets an error toast
        // instead of a "saved" recording that won't play.
        if (!stoppedForWriteFailure) {
          stoppedForWriteFailure = true;
          getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
        }
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recordingFinalize,
    async (_e, sessionId: string, meta: RecordingFinalizeMeta) => {
      let recording;
      try {
        recording = await writer.finalize(sessionId, meta);
      } catch (error) {
        cursorTracks.discard(sessionId);
        clickSessions.delete(sessionId);
        stopHookIfIdle();
        throw error;
      }
      // Best effort: a recording is never failed by its cursor track. The tracker
      // is still sampling here (finalize runs after the encoder stopped), so the
      // tail past the last frame is cut with the recording's duration. `+ 250`
      // (not `meta.durationMs` exactly) covers the last frame's own duration and
      // clock jitter: the whole point of this cut is to drop the 0.6–2 s of
      // "saving" samples, not to be frame-exact.
      const track = cursorTracks.finish(
        sessionId,
        clickSessions.delete(sessionId),
        meta.durationMs + 250,
      );
      stopHookIfIdle();
      if (track) {
        await new LibraryVault(vaultDirectory().path)
          .writeCursorTrack(recording.id, serializeCursorTrack(track))
          .catch((error) => console.error("cursor track write failed", error));
      }
      return recording;
    },
  );
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => {
    cursorTracks.discard(sessionId);
    clickSessions.delete(sessionId);
    stopHookIfIdle();
    return writer.abort(sessionId);
  });
  ipcMain.handle(
    IPC_CHANNELS.cursorTrackStart,
    async (_e, sessionId: string, sourceId: string): Promise<{ enabled: boolean }> => {
      const display = pickCapturedDisplay(
        sourceId,
        await displayIdForSource(sourceId),
        screen.getAllDisplays(),
      );
      if (!display) return { enabled: false };
      cursorTracks.start(sessionId, display);
      if (clickHook.ensureRunning()) clickSessions.add(sessionId);
      return { enabled: true };
    },
  );
  ipcMain.handle(IPC_CHANNELS.cursorClockNow, () => performance.now());
  ipcMain.on(
    IPC_CHANNELS.cursorTrackAnchor,
    (_e, sessionId: string, t0MainMs: number, quality: "exact" | "estimated") =>
      cursorTracks.get(sessionId)?.setAnchor(t0MainMs, quality),
  );
  ipcMain.on(IPC_CHANNELS.cursorTrackPause, (_e, sessionId: string, atMainMs: number) =>
    cursorTracks.get(sessionId)?.pause(atMainMs),
  );
  ipcMain.on(IPC_CHANNELS.cursorTrackResume, (_e, sessionId: string, atMainMs: number) =>
    cursorTracks.get(sessionId)?.resume(atMainMs),
  );

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
  const applyStopWindowState = (): void => {
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
  };
  ipcMain.on(IPC_CHANNELS.recordingStop, applyStopWindowState);

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

  let cameraBubbleHiddenForCapture = false;

  return {
    isActive: () => activity.active,
    toggleRecordingSetting: (key) => applySettingsPatch({ [key]: !settings[key] }),
    hideCameraBubbleForCapture: () => {
      if (!cameraBubble.isVisible()) return;
      cameraBubbleHiddenForCapture = true;
      cameraBubble.hide();
    },
    restoreCameraBubbleAfterCapture: () => {
      if (!cameraBubbleHiddenForCapture) return;
      cameraBubbleHiddenForCapture = false;
      if (settings.isCameraEnabled) cameraBubble.show();
    },
    forceReset: () => {
      cursorTracks.discardAll();
      clickSessions.clear();
      clickHook.stop();
      if (!activity.active) return;
      applyStopWindowState();
    },
  };
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
