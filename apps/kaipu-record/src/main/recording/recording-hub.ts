import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  systemPreferences,
} from "electron";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { createMainTranslator } from "@kaipu/i18n/main";
import { IPC_CHANNELS } from "@shared/types";
import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER } from "@shared/types/ipc";
import type {
  ControlCommand,
  RecorderPhaseReport,
  RecordingActivity,
  RecordingArea,
  RecordingFinalizeMeta,
  RecordingSettings,
  RecordingStartInfo,
  RecordingTick,
} from "@shared/types/ipc";
import { serializeCursorTrack } from "@shared/cursor-track";
import { buildRecordingStartedProperties, RECORDING_STARTED_EVENT } from "@shared/analytics";
import { captureMainEvent } from "../services/analytics.service";
import type { CaptureRect, RecordingRatio } from "@shared/types/screenshot-capture";
import { LibraryVault } from "../library/library-vault";
import { areaCapturedDisplay, pickCapturedDisplay } from "./captured-display";
import { ClickHook, type HookLike } from "./click-hook";
import { CursorTrackRegistry } from "./cursor-tracker";
import { ControlBarWindow } from "./control-bar-window";
import { CameraBubbleWindow } from "./camera-bubble-window";
import { RecordingShadeWindow } from "./recording-shade-window";
import { ScreenSourceCache, type ScreenSource } from "./screen-source-cache";
import { areaToGlobal, fullDisplayBorderAllowed, sanitizeArea } from "./area-geometry";
import { holdTemporaryShortcut, releaseTemporaryShortcut } from "../shortcuts/global-shortcuts";
import { FinalizeMoveError, RecordingWriter, timestampId } from "./recording-writer";
import { createMicLevelRelay } from "./mic-level-relay";
import { IDLE_ACTIVITY, applyTick, startedActivity, stoppedActivity } from "./recording-activity";
import { vaultDirectory } from "../library/vault-location";
import { endRecordTiming, markRecordTiming, receiveRecordTiming } from "./record-timing";
import {
  applyDockPolicy,
  forceRegularPolicy,
  getAppSettings,
  onSettingsChanged,
} from "../infrastructure/settings-store";

/** The three input toggles a global shortcut can flip. */
export type LiveRecordingToggle =
  | "isMicrophoneEnabled"
  | "isSystemAudioEnabled"
  | "isCameraEnabled";

export interface RecordingHubHandle {
  /** True while a recording is active or paused. */
  isActive(): boolean;
  /** True while a take is pending (countdown or acquiring): not active yet, but busy. */
  isPending(): boolean;
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
   * Make a display, or an area of it, the recording target (ADR 0030): the display's
   * `screen:` source becomes `selectedSource`, and `area` is set for a rectangle (display-
   * relative DIP) or cleared for the whole display. Resolves false, changing nothing, when
   * the display is gone, has no screen source, or the area is under the minimum size, so a
   * stale pick never records another display.
   */
  /** `ratio`: the chip the Frame box was locked to, kept on the area for capture metadata. */
  selectArea(displayId: number, rect: CaptureRect | null, ratio?: RecordingRatio): Promise<boolean>;
  /**
   * List the screen sources now, in the background, so the `selectArea` that follows a pick
   * finds them ready instead of waiting on `desktopCapturer` with nothing on screen. Call it
   * when the overlay opens to record. The list is kept until the displays change.
   */
  prefetchScreenSources(): void;
  /**
   * The next start's countdown is drawn on this region of this display (design "Kaipu Record
   * Modes"): the overlay just chose it, and the main window stays hidden. `rect` is display-
   * relative DIP, `null` for the whole display. Forgotten after `COUNTDOWN_REGION_TTL_MS`
   * when no countdown follows, so a later unrelated start never draws on a stale region.
   * The TTL starts once the main window has loaded (a recreated window cold-loads first).
   * `onAbandoned` runs when the start never came (TTL expired with no phase report) or ended
   * before a take (cancelled or failed): the caller kept the app hidden and must show its
   * window; the hub then re-asserts the Dock and activates the app, as a stop does.
   * The shade is opened here, painting the first tick (the countdown length from Settings), so
   * it is loading while the start request travels and the recorder's `recordingCountdownVisible`
   * wait is answered at once. With the countdown off (0) no shade is opened: the take starts
   * right away and its own shade appears with `recordingStart`.
   */
  prepareRegionCountdown(
    displayId: number,
    rect: CaptureRect | null,
    onAbandoned?: () => void,
  ): void;
  /**
   * Best-effort recovery when the recorder renderer is gone (crash, or the
   * main window destroyed) mid-recording or mid-countdown: resets activity, hides the bar and
   * the shades, releases a pending take (Esc, the tray), and restores the Dock policy without
   * waiting on IPC that will never arrive from a dead renderer. No-ops while idle.
   * `revealAbandoned` also brings back the app a prepared countdown had kept hidden: set it
   * when the main window is still there (a crash), not when the user closed it.
   */
  forceReset(options?: { revealAbandoned?: boolean }): void;
}

/** How long a region waits for its countdown before it is forgotten. */
export const COUNTDOWN_REGION_TTL_MS = 5000;

/** A renderer report, made safe: anything malformed is ignored. */
function parsePhaseReport(value: unknown): RecorderPhaseReport | null {
  if (!value || typeof value !== "object") return null;
  const { phase, value: tick } = value as Record<string, unknown>;
  if (phase === "counting") {
    return typeof tick === "number" && Number.isFinite(tick) ? { phase, value: tick } : null;
  }
  return phase === "starting" || phase === "idle" ? { phase } : null;
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
  /** Called on every activity change (start, pause/resume, stop); the tray menu follows it. */
  onActivityChange?: (activity: RecordingActivity) => void,
  /**
   * Called when a take becomes pending (its countdown starts) or stops being pending (it
   * started, was cancelled or failed). The tray menu disables Record and offers Cancel.
   */
  onPendingChange?: (pending: boolean) => void,
): RecordingHubHandle {
  const bar = new ControlBarWindow();
  const cameraBubble = new CameraBubbleWindow(() => getAppSettings().cameraBubble.size);
  // Shape and size apply live, mid-take included (the bubble is part of the recorded
  // screen, so the video shows the change). The shape is the renderer's; the size is the
  // window's bounds, re-placed from the anchored corner.
  let appliedBubbleSize = getAppSettings().cameraBubble.size;
  onSettingsChanged((next) => {
    if (next.cameraBubble.size === appliedBubbleSize) return;
    appliedBubbleSize = next.cameraBubble.size;
    cameraBubble.applySize();
  });
  ipcMain.handle(IPC_CHANNELS.cameraBubblePreviewSize, (_e, size: unknown): number =>
    cameraBubble.preview(typeof size === "number" ? size : appliedBubbleSize),
  );
  // Drag-to-move: the bubble renderer reports the pointer's offset; main clamps and moves.
  ipcMain.on(IPC_CHANNELS.cameraBubbleMoveStart, () => cameraBubble.beginMove());
  ipcMain.on(IPC_CHANNELS.cameraBubbleMove, (_e, dx: unknown, dy: unknown) => {
    if (typeof dx === "number" && typeof dy === "number") cameraBubble.moveBy(dx, dy);
  });
  const shade = new RecordingShadeWindow();
  const screenSources = new ScreenSourceCache(listScreenSources);
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

  /** Windows whose destruction already clears their mic-level subscriptions. */
  const micLevelWatched = new Set<number>();

  // Single source of truth for "is a recording happening", broadcast to every
  // window so non-recorder windows (reopened Record page, Capture Panel) can
  // reflect it and refuse to start a second recording. Transitions live in the
  // pure `recording-activity` module; the hub only owns the broadcast.
  let activity: RecordingActivity = IDLE_ACTIVITY;
  // A take whose countdown runs (or whose streams are acquiring): not active, but busy.
  let pending = false;
  const publicActivity = (): RecordingActivity =>
    pending && !activity.active ? { ...activity, pending: true } : activity;
  const broadcastActivity = (): void => {
    onActivityChange?.(activity);
    const state = publicActivity();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.recordingState, state);
      }
    }
  };
  ipcMain.handle(IPC_CHANNELS.recordingGetState, (): RecordingActivity => publicActivity());
  ipcMain.on(IPC_CHANNELS.recordingTiming, (_e, label: unknown, kind: unknown) =>
    receiveRecordTiming(label, kind),
  );

  // Shared recording settings — single source of truth, mirrored to every window.
  const settings: RecordingSettings = {
    selectedSource: null,
    selectedMicrophone: null,
    isMicrophoneEnabled: true,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
    area: null,
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
    applySettingsPatch(windowSettingsPatch(patch, settings));
  });
  // A display unplugged or resized after its area was chosen: the stored area no longer
  // describes it, and the engine would crop with the old size. Drop it with its source so
  // the next take asks again. A take in progress keeps its copy; stop checks again.
  const dropStaleArea = (): void => {
    const area = settings.area;
    if (!area || activity.active) return;
    const display = screen.getAllDisplays().find((candidate) => candidate.id === area.displayId);
    if (
      display &&
      display.bounds.width === area.displaySize.width &&
      display.bounds.height === area.displaySize.height
    ) {
      return;
    }
    applySettingsPatch({ selectedSource: null, area: null });
  };
  // A display change can renumber the screen sources (Windows lists them by index).
  const onDisplaysChanged = (): void => {
    screenSources.invalidate();
    dropStaleArea();
  };
  screen.on("display-added", () => screenSources.invalidate());
  screen.on("display-removed", onDisplaysChanged);
  screen.on("display-metrics-changed", onDisplaysChanged);

  // ── Disk writer ──────────────────────────────────────────────────────
  function videosDir(): string {
    try {
      return app.getPath("videos");
    } catch {
      return homedir();
    }
  }

  /** The vault is unreachable: let the user pick where the finished take goes. Resolves the chosen path, or null. */
  async function offerSaveElsewhere(sessionId: string): Promise<string | null> {
    const t = createMainTranslator(getAppSettings().locale);
    // Deliberately parentless: the main window is hidden while the control bar is up.
    const result = await dialog.showSaveDialog({
      title: t("dialogs.saveRecordingElsewhere"),
      defaultPath: join(videosDir(), `${timestampId(Date.now())}.mp4`),
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return null;
    try {
      await writer.salvage(sessionId, result.filePath);
      return result.filePath;
    } catch (error) {
      console.error("salvage failed", error);
      return null;
    }
  }

  // Whether we've already told the renderer to stop for a failed write, so the
  // "stop" is sent once per recording (writes are fire-and-forget and keep
  // arriving after the first failure). Reset on each new session.
  let stoppedForWriteFailure = false;
  // Sessions aborted before their cursor track began: `cursorTrackStart` waits on the display
  // lookup, and an abort landing meanwhile (a start that failed or was cancelled fast) found
  // nothing to discard, so the tracker then started with nobody left to stop it. Renderer ids
  // repeat after a reload, so creating a session clears its id.
  const abortedSessions = new Set<string>();
  ipcMain.handle(IPC_CHANNELS.recordingCreate, (_e, sessionId: string) => {
    stoppedForWriteFailure = false;
    abortedSessions.delete(sessionId);
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
        if (error instanceof FinalizeMoveError) {
          const saved = await offerSaveElsewhere(sessionId);
          throw new Error(
            `${saved ? FINALIZE_ELSEWHERE_MARKER : FINALIZE_KEPT_MARKER} ${error.message}`,
          );
        }
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
  // NIW2-218: Small-file size check before finalize. Takes a session id only, like write.
  ipcMain.handle(IPC_CHANNELS.recordingStat, (_e, sessionId: string): Promise<number> => {
    if (typeof sessionId !== "string") throw new Error("recordingStat: invalid session id");
    return writer.stat(sessionId);
  });
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => {
    abortedSessions.add(sessionId);
    cursorTracks.discard(sessionId);
    clickSessions.delete(sessionId);
    stopHookIfIdle();
    return writer.abort(sessionId);
  });
  ipcMain.handle(
    IPC_CHANNELS.cursorTrackStart,
    async (
      _e,
      sessionId: string,
      sourceId: string,
      area?: RecordingArea | null,
    ): Promise<{ enabled: boolean }> => {
      const display = pickCapturedDisplay(
        sourceId,
        await displayIdForSource(screenSources, sourceId),
        screen.getAllDisplays(),
      );
      if (!display || abortedSessions.has(sessionId)) return { enabled: false };
      // An area on this display: normalize to the area, so the editor's zoom lands on the
      // recorded frame (ADR 0030). An area naming another display is ignored, not trusted.
      const safe = sanitizeArea(area, { id: Number(display.id), bounds: display.bounds });
      const space = safe ? areaCapturedDisplay(display, safe) : display;
      cursorTracks.start(sessionId, space);
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
  // Set while the camera bubble is held inside a recorded area; only then does stop move it back.
  let bubbleAnchoredToArea = false;
  let cameraBubbleHiddenForCapture = false;
  const raiseFloating = (): void => {
    bar.raise();
    cameraBubble.raise();
  };

  // ── Countdown on the chosen region ─────────────────────────────────
  // The overlay chose a region and started: the countdown is drawn on it by the shade
  // (dim outside, the number inside) while the main window stays hidden. Esc cancels
  // through a global shortcut held only for the countdown, since nothing of ours has focus.
  // `drawn`: the countdown shade was opened for it. With the countdown off (Settings) nothing is
  // drawn: the take's own shade is the first thing to appear, from `recordingStart`.
  let countdownRegion: {
    display: Electron.Display;
    rect: CaptureRect | null;
    drawn: boolean;
  } | null = null;
  let countdownRegionTimer: ReturnType<typeof setTimeout> | null = null;
  let escapeHeld = false;
  const releaseEscape = (): void => {
    if (!escapeHeld) return;
    escapeHeld = false;
    releaseTemporaryShortcut("Escape");
  };
  const holdEscape = (): void => {
    if (escapeHeld) return;
    escapeHeld = holdTemporaryShortcut("Escape", () => {
      getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
    });
  };
  const setPending = (next: boolean): void => {
    if (next === pending) return;
    pending = next;
    onPendingChange?.(next);
    broadcastActivity();
  };
  // Who to tell when the prepared start never becomes a take (the app was kept hidden).
  let countdownAbandoned: (() => void) | null = null;
  // The region countdown is on screen (its shade showed the first tick), and the recorder's
  // waits for that moment (`recordingCountdownVisible`).
  let countdownShown = false;
  let countdownShownWaiters: Array<() => void> = [];
  const markCountdownShown = (): void => {
    countdownShown = true;
    const waiters = countdownShownWaiters;
    countdownShownWaiters = [];
    for (const resolve of waiters) resolve();
  };
  const clearCountdownRegion = (): void => {
    if (countdownRegionTimer) clearTimeout(countdownRegionTimer);
    countdownRegionTimer = null;
    countdownRegion = null;
    countdownAbandoned = null;
    releaseEscape();
    // Nothing is left to wait for: a waiting recorder goes on (or finds itself cancelled).
    markCountdownShown();
    countdownShown = false;
  };
  /**
   * Hand the app that was kept hidden for a countdown back to the user. The caller shows its
   * window; the rest is the same restore as a stop (`applyStopWindowState`): another app may
   * have taken focus during the click-through countdown, and a window shown without
   * activating the app comes back unfocused, with grey traffic lights.
   */
  const revealAbandoned = (notify: (() => void) | null): void => {
    if (!notify) return;
    notify();
    applyDockPolicy();
    app.focus({ steal: true });
  };
  /** The prepared start will not become a take: forget it and let the caller reveal the app. */
  const abandonCountdownRegion = (): void => {
    const notify = countdownAbandoned;
    clearCountdownRegion();
    shade.hide();
    revealAbandoned(notify);
  };
  /**
   * Open the region's shade on the countdown's first tick. It loads while the start request
   * reaches the recorder; the recorder starts its clock only once it is on screen
   * (`recordingCountdownVisible`).
   */
  const drawCountdown = (region: NonNullable<typeof countdownRegion>, seconds: number): void => {
    region.drawn = true;
    countdownShown = false;
    shade.show(
      region.display,
      region.rect,
      () => {
        if (countdownRegion !== region) return;
        markRecordTiming("countdown shade shown");
        raiseFloating();
        markCountdownShown();
      },
      { phase: "countdown", value: seconds },
    );
  };
  // Without a region the countdown is the Record page's own and is already visible. With one,
  // the shade (opened when the region was prepared) loads a renderer before it can show "3":
  // the recorder starts its clock after.
  ipcMain.handle(IPC_CHANNELS.recordingCountdownVisible, (): Promise<void> | undefined => {
    if (!countdownRegion || activity.active || countdownShown) return undefined;
    return new Promise((resolve) => countdownShownWaiters.push(resolve));
  });
  ipcMain.on(IPC_CHANNELS.recordingRecorderPhase, (_e, raw: unknown) => {
    const report = parsePhaseReport(raw);
    // Every countdown (overlay region or Record page) is a pending take for the tray.
    if (report && !activity.active) setPending(report.phase !== "idle");
    if (!report || !countdownRegion || activity.active) return;
    // The start arrived (a countdown, or straight to acquiring with no countdown): the
    // region is in use now and no longer expires.
    if (report.phase !== "idle" && countdownRegionTimer) {
      clearTimeout(countdownRegionTimer);
      countdownRegionTimer = null;
    }
    if (report.phase === "counting") {
      if (!countdownRegion.drawn) {
        // Prepared with the countdown off, yet the recorder counts: its copy of the setting
        // had not caught up. What it runs is what the user must see, so draw it now.
        drawCountdown(countdownRegion, report.value);
      } else {
        // The shade opened with the region (`prepareRegionCountdown`); a tick only repaints
        // it. Showing it again here would answer `recordingCountdownVisible` before it loaded.
        shade.update({ phase: "countdown", value: report.value });
      }
      holdEscape();
    } else if (report.phase === "starting") {
      // The gap after the countdown: its dim stays up, number cleared. Nothing to clear when
      // no countdown was drawn (it is off): the take's shade comes from `recordingStart`.
      if (countdownRegion.drawn) shade.update({ phase: "countdown", value: null });
    } else {
      // Cancelled (Esc, Stop) or failed before the take: nothing is marked any more, and the
      // app that was kept hidden for the countdown comes back.
      abandonCountdownRegion();
    }
  });

  // Bumped by every start: a display lookup still running for a take that was cancelled must
  // not show the bar or change the shade of the take that started after it.
  let takeCount = 0;
  ipcMain.on(IPC_CHANNELS.recordingStart, (_e, info: RecordingStartInfo) => {
    activity = startedActivity();
    const take = ++takeCount;
    // Before any tick of this take (same IPC order) and before the bar can show: the hidden
    // bar may still hold the previous take's "Saving…".
    bar.reset();
    // The countdown is over: Esc belongs to the apps again. The region it was drawn on is
    // kept for the shade below.
    const region = countdownRegion;
    clearCountdownRegion();
    setPending(false);
    // An area (ADR 0030): main's own, and only for the source it was chosen with: a window
    // cannot set one (`windowSettingsPatch`), so the renderer's copy in `info` is the same value.
    const chosen =
      settings.area && settings.selectedSource?.id === info.sourceId ? settings.area : null;
    const areaDisplay = chosen
      ? screen.getAllDisplays().find((display) => display.id === chosen.displayId)
      : undefined;
    const area = areaDisplay ? sanitizeArea(chosen, areaDisplay) : null;
    try {
      const scale = areaDisplay?.scaleFactor || 1;
      captureMainEvent(
        RECORDING_STARTED_EVENT,
        buildRecordingStartedProperties({
          sourceId: info.sourceId,
          area: Boolean(info.area),
          platform: process.platform,
          displays: screen.getAllDisplays().length,
          areaSize: area
            ? {
                width: Math.round(area.rect.width * scale),
                height: Math.round(area.rect.height * scale),
              }
            : null,
          ratio: area?.ratio,
        }),
      );
    } catch (error) {
      // Analytics must never change what the user sees.
      console.error("recording analytics failed", error);
    }
    getMainWindow()?.hide();
    // The main window is now hidden; force the app to stay in the Dock/Cmd+Tab so
    // it isn't lost while only the floating panels are visible. Restored on stop.
    forceRegularPolicy();
    broadcastActivity();
    // The area (above): mark it on its display and keep the camera bubble, which is
    // recorded as part of the screen, inside the area. The shade sits under the bar and
    // the bubble; raising them once it shows covers Windows, which ignores window levels.
    const areaGlobal = area && areaDisplay ? areaToGlobal(area, areaDisplay.bounds) : null;
    // Place the bar on the screen being recorded (resolved from the source id), outside the
    // area when only part of it is recorded (design "Kaipu Record Modes").
    const includeInRecording = getAppSettings().showBarInRecording;
    // A whole display gets the pink border around its edges, unless content protection
    // cannot keep it out of the video (old Windows); a window gets nothing (it moves).
    const borderAllowed = fullDisplayBorderAllowed(process.platform, release());
    // The countdown of a whole display was drawn on that display: turn it into the border
    // now, without waiting for the source lookup below, which can fail.
    const wholeDisplayCountdown = !area && region !== null && region.rect === null;
    void displayIdForSource(screenSources, info.sourceId).then((displayId) => {
      // Stopped (or cancelled) while the lookup ran: the always-on-top bar must not come up
      // over a take that is already gone, nor act for it on a take started since.
      if (!activity.active || take !== takeCount) return;
      bar.show(displayId, { includeInRecording, anchor: areaGlobal });
      if (area || wholeDisplayCountdown) return;
      const display =
        displayId === undefined
          ? undefined
          : screen.getAllDisplays().find((d) => String(d.id) === displayId);
      if (display && borderAllowed) shade.show(display, null, raiseFloating);
      // A lookup that failed (or a window) leaves no countdown dim behind.
      else shade.hide();
    });
    if (area && areaDisplay && areaGlobal) {
      shade.show(areaDisplay, area.rect, raiseFloating);
      cameraBubble.anchorTo(areaGlobal);
      bubbleAnchoredToArea = true;
    } else if (wholeDisplayCountdown && region) {
      if (borderAllowed) shade.show(region.display, null, raiseFloating);
      else shade.hide();
    } else if (region) {
      // A countdown drawn on a region that is not the take's area: never leave its dim up.
      shade.hide();
    }
  });
  const applyStopWindowState = (): void => {
    activity = stoppedActivity(activity);
    bar.hide();
    shade.hide();
    if (bubbleAnchoredToArea) {
      bubbleAnchoredToArea = false;
      cameraBubble.anchorTo(null);
      // A bubble an area was too small for comes back now, if the camera is still on and no
      // screenshot has it hidden.
      if (settings.isCameraEnabled && !cameraBubbleHiddenForCapture) cameraBubble.show();
    }
    dropStaleArea();
    const main = getMainWindow();
    main?.show();
    main?.focus();
    endRecordTiming("main window shown");
    // Hiding the main window for the recording can drop the app from the Dock /
    // Cmd+Tab on macOS; re-assert the policy and bring the app forward so it's
    // back in the switcher (respects the "show in Dock" setting).
    applyDockPolicy();
    app.focus({ steal: true });
    broadcastActivity();
  };
  ipcMain.on(IPC_CHANNELS.recordingStop, applyStopWindowState);

  // ── Relay ────────────────────────────────────────────────────────────
  // Mic levels for the settings meter: only the windows that subscribed get them, and the
  // recorder is told whether anyone does so it does not even send otherwise.
  const micLevels = createMicLevelRelay(() => getMainWindow()?.webContents ?? null);
  ipcMain.on(IPC_CHANNELS.micLevelsSubscribe, (e) => {
    const sender = e.sender;
    micLevels.subscribe(sender);
    if (!micLevelWatched.has(sender.id)) {
      micLevelWatched.add(sender.id);
      sender.once("destroyed", () => {
        micLevelWatched.delete(sender.id);
        micLevels.remove(sender.id);
      });
    }
  });
  ipcMain.on(IPC_CHANNELS.micLevelsUnsubscribe, (e) => micLevels.unsubscribe(e.sender.id));
  ipcMain.on(IPC_CHANNELS.micLevelsReport, (_e, levels: unknown) => {
    // From a renderer: pass on only a short list of plain numbers.
    if (!Array.isArray(levels) || levels.length > 16) return;
    if (!levels.every((level) => typeof level === "number" && Number.isFinite(level))) return;
    micLevels.publish(levels);
  });
  ipcMain.handle(IPC_CHANNELS.micLevelsGetListening, () => micLevels.listening());
  ipcMain.on(IPC_CHANNELS.recordingReportTick, (_e, tick: RecordingTick) => {
    bar.sendTick(tick);
    const next = applyTick(activity, tick);
    activity = next.activity;
    if (next.changed) broadcastActivity();
  });
  ipcMain.on(IPC_CHANNELS.controlCommand, (_e, command: ControlCommand) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, command);
  });

  return {
    isActive: () => activity.active,
    isPending: () => pending && !activity.active,
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
    prepareRegionCountdown: (displayId, rect, onAbandoned) => {
      clearCountdownRegion();
      if (activity.active) return;
      const display = screen.getAllDisplays().find((candidate) => candidate.id === displayId);
      const area = display && rect ? sanitizeArea({ displayId, rect }, display) : null;
      if (!display || (rect && !area)) {
        // Nothing to draw on, but the start may still be dropped: the app must come back.
        revealAbandoned(onAbandoned ?? null);
        return;
      }
      const seconds = getAppSettings().recordingCountdownSeconds;
      const prepared = { display, rect: area ? area.rect : null, drawn: false };
      countdownRegion = prepared;
      countdownAbandoned = onAbandoned ?? null;
      if (seconds > 0) {
        // Open the shade now, on the first tick (the configured length), instead of after the
        // recorder's first tick report.
        drawCountdown(prepared, seconds);
      } else {
        // No countdown, so no dim and no number: the recorder does not wait for either.
        markCountdownShown();
      }
      // The TTL counts from when the recorder can answer: a recreated main window loads first.
      const startTtl = (): void => {
        if (countdownRegion !== prepared || countdownRegionTimer) return;
        countdownRegionTimer = setTimeout(abandonCountdownRegion, COUNTDOWN_REGION_TTL_MS);
      };
      const contents = getMainWindow()?.webContents;
      if (contents?.isLoading?.()) contents.once("did-finish-load", startTtl);
      else startTtl();
    },
    prefetchScreenSources: () => screenSources.prefetch(),
    selectArea: async (displayId, rect, ratio) => {
      // The source is locked for the length of a take.
      if (activity.active) return false;
      const display = screen.getAllDisplays().find((candidate) => candidate.id === displayId);
      if (!display) return false;
      const area = rect ? sanitizeArea({ displayId, rect, ratio }, display) : null;
      if (rect && !area) return false;
      markRecordTiming("selectArea: resolving the screen source");
      const source = await screenSourceForDisplay(
        screenSources,
        displayId,
        screen.getAllDisplays().length,
      );
      markRecordTiming(`selectArea: screen source ${source ? "resolved" : "missing"}`);
      if (!source) return false;
      const t = createMainTranslator(getAppSettings().locale);
      applySettingsPatch({
        selectedSource: {
          id: source.id,
          name: area
            ? t("record.areaSource", { width: area.rect.width, height: area.rect.height })
            : source.name,
          type: "screen",
        },
        area,
      });
      return true;
    },
    forceReset: (options) => {
      // Its takes will never be finalized or aborted: release their file handles. The partial
      // files stay on disk.
      void writer.releaseAll().catch((error) => console.error("releasing takes failed", error));
      cursorTracks.discardAll();
      clickSessions.clear();
      clickHook.stop();
      // A shade must never outlive the renderer that would have stopped it.
      const notify = countdownAbandoned;
      clearCountdownRegion();
      setPending(false);
      shade.hide();
      if (options?.revealAbandoned) revealAbandoned(notify);
      if (!activity.active) return;
      applyStopWindowState();
    },
  };
}

/** Every `screen:` source, without thumbnails (the cheapest listing). */
function listScreenSources(): Promise<ScreenSource[]> {
  return desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
}

/** Resolve which display a screen source belongs to (windows have none). */
async function displayIdForSource(
  sources: ScreenSourceCache,
  sourceId: string,
): Promise<string | undefined> {
  if (!sourceId.startsWith("screen:")) return undefined;
  const source = await sources.find((list) => list.find((candidate) => candidate.id === sourceId));
  return source?.display_id || undefined;
}

/**
 * The `screen:` source that records a display. Some platforms report an empty `display_id`;
 * with a single display that source is unambiguous, with several it is not trusted.
 */
async function screenSourceForDisplay(
  sources: ScreenSourceCache,
  displayId: number,
  displayCount: number,
): Promise<{ id: string; name: string } | null> {
  const match = await sources.find(
    (list) =>
      list.find((source) => source.display_id === String(displayId)) ??
      (displayCount === 1 && list.length === 1 ? list[0] : undefined),
  );
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * A settings patch from a window. Only main sets an area, together with its display's screen
 * source (`selectArea`), so a window may clear the area but never set one, and a window that
 * changes the source clears it: `area` never names a display `selectedSource` does not record.
 */
export function windowSettingsPatch(
  patch: Partial<RecordingSettings>,
  current: RecordingSettings,
): Partial<RecordingSettings> {
  if (!patch || typeof patch !== "object") return {};
  const next = { ...patch };
  if ("area" in next && next.area !== null) delete next.area;
  if ("selectedSource" in next && next.selectedSource?.id !== current.selectedSource?.id) {
    next.area = null;
  }
  return next;
}
