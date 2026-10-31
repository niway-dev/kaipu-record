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
import { dirname, join } from "node:path";
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
import { recordingWriterKind } from "@shared/webcam-track";
import { buildRecordingStartedProperties, RECORDING_STARTED_EVENT } from "@shared/analytics";
import { captureMainEvent } from "../services/analytics.service";
import type { CaptureRect, RecordingRatio } from "@shared/types/screenshot-capture";
import { LibraryVault } from "../library/library-vault";
import { vaultActivity, type ActivityLease } from "../library/vault-activity";
import type { LocalRecording } from "@shared/types/library-storage";
import { areaCapturedDisplay, pickCapturedDisplay } from "./captured-display";
import { ClickHook, type HookLike } from "./click-hook";
import { CursorTrackRegistry } from "./cursor-tracker";
import { ControlBarWindow } from "./control-bar-window";
import { CameraBubbleWindow } from "./camera-bubble-window";
import { BubbleProtection } from "./bubble-protection";
import { RecordingShadeWindow } from "./recording-shade-window";
import { ScreenSourceCache, type ScreenSource } from "./screen-source-cache";
import {
  areaToGlobal,
  bubblePlacementInRect,
  canExcludeWindowFromCapture,
  sanitizeArea,
  withRecordedBubble,
  type Rect,
} from "./area-geometry";
import { holdTemporaryShortcut, releaseTemporaryShortcut } from "../shortcuts/global-shortcuts";
import { defaultCaptureName } from "@shared/default-capture-name";
import { FinalizeMoveError, RecordingWriter } from "./recording-writer";
import { createMicLevelRelay } from "./mic-level-relay";
import { onPageGone, type RendererContents } from "../renderer-lifetime";
import { IDLE_ACTIVITY, applyTick, startedActivity, stoppedActivity } from "./recording-activity";
import { notifyWorkspaceBusyChanged, requireCaptureWorkspace } from "../workspaces";
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
  /** A writer session is open: a take or an editor export is writing into the workspace. */
  hasOpenWrites(): boolean;
  /**
   * The display the latest take recorded (its area's, its countdown's, or its screen
   * source's), or null before any take or when the source names none (a window). The
   * "Your video is ready" window opens there.
   */
  lastTakeDisplayId(): number | null;
  /**
   * Flip one of the three input toggles, exactly as clicking it in a window
   * does (the global shortcuts use this). Mid-take the recorder picks the
   * change up from the settings broadcast; outside a take it is just the
   * pre-recording setting.
   */
  toggleRecordingSetting(key: LiveRecordingToggle): void;
  /**
   * Hide the camera bubble for the duration of a screenshot capture (it sits
   * always-on-top, and where capture cannot exclude it — Windows before 10 2004 — it would
   * land in the shot) without releasing
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
  /** Load the countdown/recording shade window hidden, so the first countdown does not wait. */
  prewarmShade(): void;
  /**
   * Quit: stop the click hook and the cursor sampling, release the writer's file handles and
   * destroy the shade, control bar and camera bubble windows. The quit guards have already
   * stopped or reset any take, so nothing here waits on a renderer.
   */
  dispose(): void;
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

/** Ended session ids remembered to refuse a late cursor track; a late one is seconds late at most. */
const ENDED_SESSIONS_CAP = 64;

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
  // The bubble leaves the capture only while its face is recorded in the take's webcam file
  // (or before a take, which then records one): otherwise it stays in the screen recording.
  const bubbleProtection = new BubbleProtection();
  const cameraBubble = new CameraBubbleWindow(
    () => getAppSettings().cameraBubble.size,
    () => canExcludeWindowFromCapture(process.platform, release()) && bubbleProtection.protects(),
  );
  // Shape and size apply live, mid-take included (the user sees the bubble change; the
  // recording does not, its face is the raw webcam file, restyled on export). The shape is
  // the renderer's; the size is the window's bounds, re-placed from the anchored corner.
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
  // The rectangle of the screen the current take records (global DIP): its area, or its whole
  // display; null for a window, whose bounds main cannot read. The bubble's recorded
  // position is normalized to it at finalize.
  let recordedRect: Rect | null = null;
  const screenSources = new ScreenSourceCache(listScreenSources);
  const writer = new RecordingWriter({
    // The active workspace, checked to be connected: a take in a workspace that is not
    // connected is refused, never recorded somewhere else (ADR 0032, decision 8).
    vaultDir: async () => (await requireCaptureWorkspace()).path,
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
    // The switcher locks while a take runs ("Finish the recording to switch").
    notifyWorkspaceBusyChanged();
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

  // Shared recording settings — single source of truth, mirrored to every window. The
  // microphone starts as the one the user last picked (the renderer remembers a pick in
  // AppSettings, never an automatic default); the rest starts fresh.
  const settings: RecordingSettings = {
    selectedSource: null,
    selectedMicrophone: getAppSettings().microphone,
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
        // A window parked by this take whose webcam file has since ended (its renderer could
        // not keep it going) is replaced: a new window, unprotected, is the one a running
        // capture is known to record, so the face lands in the screen as before (legacy path).
        if (cameraBubble.isParked() && !takeRecordsWebcam()) cameraBubble.destroy();
        cameraBubble.show();
        // Showing a floating panel can drop the app from the Dock/Cmd+Tab on
        // macOS; re-assert the policy so the app stays reachable.
        applyDockPolicy();
      } else if (takeRecordsWebcam()) {
        // Mid-take, with the face going to its webcam file: park (hide, keep, still protected)
        // instead. The running screen capture leaves out the windows that were on screen when
        // it started, so turning the camera on again must bring back this same window; a new
        // one would be captured. Its renderer stops its camera on the toggle (the light goes
        // off), and the recorder holds the webcam file on the same clock through the gap.
        cameraBubble.park();
      } else {
        // Destroy (not hide): the bubble holds the camera via getUserMedia, so
        // tearing down its window releases the device and turns the green
        // in-use light off, whatever its renderer does.
        cameraBubble.destroy();
      }
    }
  };
  /**
   * The take in progress records the face in its own webcam file: a camera turned off parks the
   * bubble then. A take that started with the camera off, or whose webcam file ended, does not:
   * there the bubble is in the screen (legacy path).
   */
  function takeRecordsWebcam(): boolean {
    return activity.active && bubbleProtection.recordsWebcam();
  }
  /** A parked bubble never outlives its take: once the take ends, the camera still off, it goes. */
  function releaseParkedBubble(): void {
    if (cameraBubble.isParked() && !settings.isCameraEnabled) cameraBubble.destroy();
  }
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
      defaultPath: join(videosDir(), `${defaultCaptureName("recording")}.mp4`),
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
  // Sessions whose take already ended (aborted, finalized or dropped by a forced reset):
  // `cursorTrackStart` waits on the display lookup, and an end landing meanwhile (a start that
  // failed or was cancelled fast, a renderer that gave up on the handshake) found nothing to
  // discard, so the tracker then started with nobody left to stop it. Renderer ids repeat
  // after a reload, so creating a session clears its id; the oldest ids fall off past a cap.
  const endedSessions = new Set<string>();
  const markEnded = (sessionId: string): void => {
    endedSessions.delete(sessionId);
    endedSessions.add(sessionId);
    if (endedSessions.size > ENDED_SESSIONS_CAP) {
      const oldest = endedSessions.values().next().value;
      if (oldest !== undefined) endedSessions.delete(oldest);
    }
  };
  // Maintenance mode (NIW2-561, C9): a take holds one activity lease from create through
  // finalize, its cursor-track write and abort cleanup, so "Check and fix files" can never
  // start in that window. A refused create starts nothing.
  //
  // A take (a recording, or an export's output) belongs to the page that created it. A page
  // that goes away without ending it (a plain reload, a dead renderer, a destroyed window)
  // never will. A recording is released (handle closed, `.part` kept for the stranded-take
  // sweep, as a forced reset does): a reload is not a discard, and the partial may be the only
  // copy. An export is discarded: its source is still in the library, so it can be exported
  // again, and its partial is no recording to recover.
  //
  // One lifecycle per take: however many events end it (a finalize, an abort, a navigation, a
  // crash, a destroy), it ends once, and its lease is freed only after its create, its
  // finalize (with the cursor track) and the writer cleanup have all settled. A create still
  // opening its file, or a finalize still placing it, therefore keeps the vault busy.
  type TakeKind = "recording" | "export";
  interface Take {
    kind: TakeKind;
    lease: ActivityLease;
    /** The creating renderer's webContents id, when the create came with a sender. */
    owner: number | null;
    /** Settles (never rejects) once `writer.create()` has. */
    created: Promise<void>;
    /** This take's staging file, once created: binds the writer cleanup to its own session. */
    tempPath?: string;
    /**
     * Settles (never rejects) once the take's webcam session create has, when it asked for one
     * (ADR 0037): the same id, so finalize and every end treat the pair as one take.
     */
    webcamCreated?: Promise<void>;
    /** Settles (never rejects) once its finalize and cursor-track write have. */
    finalizing?: Promise<void>;
    /** Set by the first end: the writer cleanup, then the lease release. */
    ending?: Promise<void>;
  }
  const recordingLeases = new Map<string, Take>();
  /** Frees `take`'s lease, and its id while that take still holds it. */
  const releaseTake = (sessionId: string, take: Take): void => {
    take.lease.release(); // idempotent
    if (recordingLeases.get(sessionId) === take) recordingLeases.delete(sessionId);
  };
  /**
   * Ends `take` once: waits for its create and any finalize in flight, runs `cleanup` on its
   * own writer session, then frees the vault.
   */
  const endTake = (
    sessionId: string,
    take: Take,
    cleanup: (sessionId: string, tempPath: string | undefined) => Promise<void>,
  ): Promise<void> => {
    take.ending ??= take.created
      .then(() => take.webcamCreated)
      .then(() => take.finalizing)
      .then(() => cleanup(sessionId, take.tempPath))
      .finally(() => releaseTake(sessionId, take));
    return take.ending;
  };
  /**
   * An export's partial is discarded however its take ends, a stranded one included (a finalize
   * that failed, its save dialog cancelled): kept, the sweep would recover it as a recording.
   */
  const discardExport = (id: string, tempPath: string | undefined): Promise<void> =>
    tempPath === undefined ? Promise.resolve() : writer.discardExport(id, tempPath);
  /** What a page gone without ending its take does to it (see above). */
  const abandonCleanup =
    (take: Take) =>
    (id: string, tempPath: string | undefined): Promise<void> =>
      take.kind === "export" ? discardExport(id, tempPath) : writer.release(id, tempPath);
  // The renderer whose `recordingStart` made the recording active: if its page goes, nobody
  // will send the stop, so the bar and the hidden main window are restored here.
  let activityOwner: number | null = null;
  /** The page is gone with a take open: forget it as a forced reset would, then free the vault. */
  const abandonTake = (sessionId: string, take: Take): void => {
    if (take.ending) return;
    markEnded(sessionId);
    // No page will finalize or abort it: protect the bubble again for the next take.
    bubbleProtection.ended(sessionId);
    cameraBubble.applyProtection();
    releaseParkedBubble();
    // A finalize in flight finishes its own cursor track; anything else is dropped.
    if (!take.finalizing) {
      cursorTracks.discard(sessionId);
      clickSessions.delete(sessionId);
      stopHookIfIdle();
    }
    void endTake(sessionId, take, abandonCleanup(take)).catch((error) =>
      console.error("releasing an abandoned take failed", error),
    );
  };
  const watchedPages = new Set<number>();
  const watchPage = (contents: RendererContents): void => {
    if (watchedPages.has(contents.id)) return;
    watchedPages.add(contents.id);
    onPageGone(contents, () => {
      for (const [sessionId, take] of recordingLeases) {
        if (take.owner === contents.id) abandonTake(sessionId, take);
      }
      if (activity.active && activityOwner === contents.id) applyStopWindowState();
    });
  };
  /**
   * A take with the webcam on has a second writer session of kind "webcam" under the same id
   * (ADR 0037). It joins the open recording take: its lease, its owner and its one lifecycle,
   * so finalize waits for it and every end (`endTake`) releases or discards both files.
   */
  const createWebcam = async (sessionId: string): Promise<{ tempPath: string }> => {
    // The bubble leaves the screen capture through content protection (ADR 0037). Where that
    // cannot exclude a window (Windows before 10 2004) it stays in the video, so a webcam
    // file would draw the face twice. The renderer asks first (`recordingWebcamTrackSupported`)
    // and never opens one there; this refusal only backs that up.
    if (!canExcludeWindowFromCapture(process.platform, release())) {
      throw new Error("webcam track unavailable: this Windows build cannot exclude the bubble");
    }
    const take = recordingLeases.get(sessionId);
    const refuse = (why: string): Error =>
      new Error(`recording:create "${sessionId}" webcam: ${why}`);
    if (!take || take.kind !== "recording") throw refuse("no recording take with this id");
    if (take.webcamCreated) throw refuse("the take already has a webcam");
    if (take.ending || take.finalizing) throw refuse("the take already ended");
    // Claimed before the wait, so a second webcam create is refused and an end waits for it.
    let settle!: () => void;
    take.webcamCreated = new Promise<void>((resolve) => (settle = resolve));
    bubbleProtection.webcamCreated(sessionId);
    cameraBubble.applyProtection();
    try {
      await take.created; // the webcam part sits beside the screen's, in its folder
      if (take.tempPath === undefined) throw refuse("the screen file did not open");
      if (take.ending || take.finalizing) throw refuse("the take already ended");
      const created = await writer.create(sessionId, "webcam");
      if (take.ending) {
        // Ended while the file was opening: that end's cleanup (it waited for this) owns it.
        throw refuse("the take ended before its webcam file opened");
      }
      return created;
    } catch (error) {
      // No webcam file after all: the bubble goes back into the capture before the renderer,
      // told by the rejection, starts the screen.
      bubbleProtection.webcamEnded(sessionId);
      cameraBubble.applyProtection();
      throw error;
    } finally {
      settle();
    }
  };
  ipcMain.handle(
    IPC_CHANNELS.recordingCreate,
    async (e, sessionId: string, requestedKind?: unknown) => {
      if (requestedKind === "webcam") return createWebcam(sessionId);
      // An id still held by a take (open, finalizing or ending) is refused: its file may be the
      // only copy, and its cleanup must never land on a new session.
      if (recordingLeases.has(sessionId)) {
        throw new Error(`recording:create "${sessionId}": a take with this id is still open`);
      }
      // Anything but an explicit export is a recording: a partial of unknown kind is kept.
      const kind: TakeKind = requestedKind === "export" ? "export" : "recording";
      const sender = (e as { sender?: RendererContents } | undefined)?.sender;
      const owner = sender && typeof sender.on === "function" ? sender.id : null;
      if (sender && owner !== null) watchPage(sender);
      const lease = vaultActivity.admit(kind);
      const creating = writer.create(sessionId);
      const take: Take = {
        kind,
        lease,
        owner,
        created: creating.then(
          ({ tempPath }) => {
            take.tempPath = tempPath;
          },
          () => undefined,
        ),
      };
      recordingLeases.set(sessionId, take);
      stoppedForWriteFailure = false;
      endedSessions.delete(sessionId);
      // A background export writes through the same sessions but is not a live take: it never
      // touches the bubble's protection, which follows the live take alone.
      if (kind === "recording") {
        // A new take: no webcam file until its webcam session says so. Before its screen
        // capture starts (the renderer creates both sessions first), so a bubble turned on
        // in a take without a webcam is created in the capture, and one that is already up
        // is protected again by the webcam session.
        bubbleProtection.screenCreated(sessionId);
        cameraBubble.applyProtection();
      }
      let created: Awaited<ReturnType<RecordingWriter["create"]>>;
      try {
        created = await creating;
      } catch (error) {
        releaseTake(sessionId, take);
        throw error;
      }
      await take.created; // `tempPath` is recorded before anything can end the take
      if (take.ending) {
        // Ended while the file was opening (its page left, or an abort): that end owns the file.
        await take.ending.catch(() => {});
        throw new Error(`recording:create "${sessionId}": the take ended before its file opened`);
      }
      return created;
    },
  );
  // Whether a take can record the webcam as its own file: only where the bubble can leave the
  // screen capture. Elsewhere (Windows before 10 2004) the face stays in the screen, by design.
  ipcMain.handle(IPC_CHANNELS.recordingWebcamTrackSupported, (): boolean =>
    canExcludeWindowFromCapture(process.platform, release()),
  );
  /**
   * The take records no (more) webcam file (its camera did not open, was turned off, was
   * unplugged, could not be opened again, or its encoder or writes failed): the bubble must be
   * in the screen recording again. Before the take's capture starts, dropping the protection is
   * enough. Once it runs, a protected window on screen is replaced by a new one, unprotected,
   * at the same place: a running ScreenCaptureKit stream is known to record a window created
   * after it started, while one that only drops its protection is unverified (spike rows 4/5,
   * ADR 0037). A parked window (camera off) is replaced when the camera is turned on again.
   */
  function bubbleRejoinsCapture(sessionId: string): void {
    bubbleProtection.webcamEnded(sessionId);
    if (
      activity.active &&
      !takeRecordsWebcam() &&
      settings.isCameraEnabled &&
      cameraBubble.isProtected() &&
      !cameraBubble.isParked()
    ) {
      // Hidden for a screenshot: the restore after it shows the new window.
      cameraBubble.replace(!cameraBubbleHiddenForCapture);
      applyDockPolicy();
      return;
    }
    cameraBubble.applyProtection();
  }
  // The take records no (more) webcam file (its camera did not open, was turned off, was
  // unplugged, or its encoder failed): the bubble must be in the screen recording again.
  ipcMain.handle(IPC_CHANNELS.recordingWebcamEnded, (_e, sessionId: unknown) => {
    if (typeof sessionId !== "string") return;
    bubbleRejoinsCapture(sessionId);
  });
  ipcMain.on(
    IPC_CHANNELS.recordingWrite,
    (_e, sessionId: string, data: ArrayBuffer, position: number, kind?: unknown) => {
      const writerKind = recordingWriterKind(kind);
      void writer.write(sessionId, data, position, writerKind).catch((error) => {
        console.error(`recording ${writerKind} write failed`, error);
        // The webcam never fails the take: finalize drops a webcam whose write failed. Its
        // face then has to be in the screen: the bubble rejoins the capture, as for an
        // unplugged camera (`bubbleRejoinsCapture`).
        if (writerKind === "webcam") {
          bubbleRejoinsCapture(sessionId);
          return;
        }
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
    async (_e, sessionId: string, rendererMeta: RecordingFinalizeMeta) => {
      // The renderer never retries a finalize (it aborts), so the take ends here either way.
      markEnded(sessionId);
      // The engine stopped before finalize: protect the bubble again for the next take.
      bubbleProtection.ended(sessionId);
      cameraBubble.applyProtection();
      // Where the bubble sat, as main sees its window: the stop has not released the area yet
      // (the renderer sends it after finalize), so the bubble is still where it was recorded.
      // A camera off at the end parked it: where it was before it was turned off.
      const bubbleBounds = cameraBubble.placedBounds();
      releaseParkedBubble();
      const meta = withRecordedBubble(
        rendererMeta,
        bubbleBounds && recordedRect ? bubblePlacementInRect(bubbleBounds, recordedRect) : null,
      );
      const take = recordingLeases.get(sessionId);
      if (!take) return finalizeTake(sessionId, meta); // the writer refuses an unknown session
      if (take.ending || take.finalizing) {
        throw new Error(`recording:finalize "${sessionId}": the take already ended`);
      }
      // Finalize is part of the take: an end arriving meanwhile (a reload) waits for it, and
      // the lease is freed only once the file is placed and its cursor track written.
      const finalizing = take.created
        .then(() => take.webcamCreated)
        .then(() => finalizeTake(sessionId, meta));
      take.finalizing = finalizing.then(
        () => undefined,
        () => undefined,
      );
      try {
        return await finalizing;
      } finally {
        // A placed take is the vault's. A stranded recording is kept for recovery (the save
        // dialog has had its chance); a stranded export is discarded.
        const cleanup = take.kind === "export" ? discardExport : async () => {};
        await endTake(sessionId, take, cleanup).catch(() => {});
      }
    },
  );
  const finalizeTake = async (
    sessionId: string,
    meta: RecordingFinalizeMeta,
  ): Promise<LocalRecording> => {
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
    // tail past the last frame is cut with the recording's VIDEO duration at the
    // stop request (measured from the first media sample, see recorder-store
    // `videoClock`) — the same time base as the samples. `+ 250` (not
    // `meta.durationMs` exactly) covers the frames `output.finalize()` flushes
    // after the request, the last frame's own duration and clock jitter: the
    // whole point of this cut is to drop the 0.6–2 s of "saving" samples, not
    // to be frame-exact.
    const track = cursorTracks.finish(
      sessionId,
      clickSessions.delete(sessionId),
      meta.durationMs + 250,
    );
    stopHookIfIdle();
    if (track) {
      // The folder the take was saved in, not the setting read again (C9).
      await new LibraryVault(dirname(recording.filePath))
        .writeCursorTrack(recording.id, serializeCursorTrack(track))
        .catch((error) => console.error("cursor track write failed", error));
    }
    return recording;
  };
  // NIW2-218: Small-file size check before finalize. Takes a session id only, like write.
  ipcMain.handle(
    IPC_CHANNELS.recordingStat,
    (_e, sessionId: string, kind?: unknown): Promise<number> => {
      if (typeof sessionId !== "string") throw new Error("recordingStat: invalid session id");
      return writer.stat(sessionId, recordingWriterKind(kind));
    },
  );
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => {
    markEnded(sessionId);
    bubbleProtection.ended(sessionId);
    cameraBubble.applyProtection();
    releaseParkedBubble();
    cursorTracks.discard(sessionId);
    clickSessions.delete(sessionId);
    stopHookIfIdle();
    // The user discarded it: the only end that deletes a recording's partial. A take still
    // being created is aborted once its file exists, and keeps the vault busy until then.
    const take = recordingLeases.get(sessionId);
    if (take) {
      return endTake(sessionId, take, (id, tempPath) =>
        take.kind === "export" ? discardExport(id, tempPath) : writer.abort(id, tempPath),
      );
    }
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
      if (endedSessions.has(sessionId)) return { enabled: false };
      const display = pickCapturedDisplay(
        sourceId,
        await displayIdForSource(screenSources, sourceId),
        screen.getAllDisplays(),
      );
      // Checked again: the take may have ended while the lookup ran.
      if (!display || endedSessions.has(sessionId)) return { enabled: false };
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
      markRecordTiming("Esc pressed: stop sent to the recorder");
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
  const abandonCountdownRegion = (reason: string): void => {
    markRecordTiming(`countdown region abandoned (${reason})`);
    const notify = countdownAbandoned;
    clearCountdownRegion();
    shade.hide();
    // Nothing of a take is on screen: the bar never belongs over an idle app.
    bar.hide();
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
      abandonCountdownRegion("the recorder went back to idle");
    }
  });

  // The countdown ended: the recorder asks this right before `recordingStart` (which hides the
  // window too), on the same IPC pipe, so the answer is the state the take starts from. A take
  // acquired during the countdown already captures the screen: told the window was on screen,
  // it waits for it to leave the capture before it encodes.
  ipcMain.handle(IPC_CHANNELS.recordingHideMainWindow, (): boolean => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    mainWindow.hide();
    return true;
  });

  // Bumped by every start: a display lookup still running for a take that was cancelled must
  // not show the bar or change the shade of the take that started after it.
  let takeCount = 0;
  let lastTakeDisplayId: number | null = null;
  ipcMain.on(IPC_CHANNELS.recordingStart, (e, info: RecordingStartInfo) => {
    activity = startedActivity();
    const senderId = (e as { sender?: { id?: unknown } } | undefined)?.sender?.id;
    activityOwner = typeof senderId === "number" ? senderId : null;
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
    lastTakeDisplayId = areaDisplay?.id ?? region?.display.id ?? null;
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
    // The area (above): mark it on its display and keep the camera bubble inside the area,
    // as the user sees it against what is recorded (the face itself comes from the webcam
    // file, not from this window). The shade sits under the bar and
    // the bubble; raising them once it shows covers Windows, which ignores window levels.
    const areaGlobal = area && areaDisplay ? areaToGlobal(area, areaDisplay.bounds) : null;
    recordedRect = areaGlobal;
    // Place the bar on the screen being recorded (resolved from the source id), outside the
    // area when only part of it is recorded (design "Kaipu Record Modes").
    const includeInRecording = getAppSettings().showBarInRecording;
    // A whole display gets the pink border around its edges, unless content protection
    // cannot keep it out of the video (old Windows); a window gets nothing (it moves).
    const borderAllowed = canExcludeWindowFromCapture(process.platform, release());
    // The countdown of a whole display was drawn on that display: turn it into the border
    // now, without waiting for the source lookup below, which can fail.
    const wholeDisplayCountdown = !area && region !== null && region.rect === null;
    void displayIdForSource(screenSources, info.sourceId).then((displayId) => {
      // Stopped (or cancelled) while the lookup ran: the always-on-top bar must not come up
      // over a take that is already gone, nor act for it on a take started since.
      if (!activity.active || take !== takeCount) return;
      if (!areaDisplay && displayId !== undefined && Number.isFinite(Number(displayId))) {
        lastTakeDisplayId = Number(displayId);
      }
      bar.show(displayId, { includeInRecording, anchor: areaGlobal });
      const display =
        displayId === undefined
          ? undefined
          : screen.getAllDisplays().find((d) => String(d.id) === displayId);
      if (!area && display) recordedRect = { ...display.bounds };
      if (area || wholeDisplayCountdown) return;
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
    releaseParkedBubble();
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
      // A reload or a dead renderer drops the page without running its unsubscribe, so its
      // count would keep the recorder sending forever; the reloaded page subscribes afresh.
      sender.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) micLevels.remove(sender.id);
      });
      sender.on("render-process-gone", () => micLevels.remove(sender.id));
    }
  });
  ipcMain.on(IPC_CHANNELS.micLevelsUnsubscribe, (e) => micLevels.unsubscribe(e.sender.id));
  ipcMain.on(IPC_CHANNELS.micLevelsReport, (e, levels: unknown) => {
    // Only the recorder (the main window's renderer) reports levels, and only a short list
    // of plain numbers, clamped to what a bar can show.
    if (e.sender.id !== getMainWindow()?.webContents.id) return;
    if (!Array.isArray(levels) || levels.length > 16) return;
    if (!levels.every((level) => typeof level === "number" && Number.isFinite(level))) return;
    micLevels.publish(levels.map((level: number) => Math.min(1, Math.max(0, level))));
  });
  ipcMain.handle(IPC_CHANNELS.micLevelsGetListening, () => micLevels.listening());
  ipcMain.on(IPC_CHANNELS.recordingReportTick, (_e, tick: RecordingTick) => {
    bar.sendTick(tick);
    const next = applyTick(activity, tick);
    activity = next.activity;
    if (next.changed) broadcastActivity();
  });
  ipcMain.on(IPC_CHANNELS.controlCommand, (_e, command: ControlCommand) => {
    markRecordTiming(`control bar: ${command}`);
    getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, command);
  });

  return {
    isActive: () => activity.active,
    isPending: () => pending && !activity.active,
    lastTakeDisplayId: () => lastTakeDisplayId,
    hasOpenWrites: () => writer.ids().length > 0,
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
        countdownRegionTimer = setTimeout(
          () => abandonCountdownRegion("no start arrived in time"),
          COUNTDOWN_REGION_TTL_MS,
        );
      };
      const contents = getMainWindow()?.webContents;
      if (contents?.isLoading?.()) contents.once("did-finish-load", startTtl);
      else startTtl();
    },
    prefetchScreenSources: () => screenSources.prefetch(),
    prewarmShade: () => shade.prewarm(),
    dispose: () => {
      // Every step on its own: one that throws must not leave a window for the quit to wait on.
      const steps: Array<[string, () => void]> = [
        ["click hook", () => clickHook.stop()],
        ["cursor tracks", () => cursorTracks.discardAll()],
        ["click sessions", () => clickSessions.clear()],
        ["countdown region", () => clearCountdownRegion()],
        [
          "writer",
          () =>
            void writer
              .releaseAll()
              .catch((error) => console.error("releasing takes failed", error)),
        ],
        ["shade", () => shade.destroy()],
        ["control bar", () => bar.destroy()],
        ["camera bubble", () => cameraBubble.dispose()],
      ];
      for (const [name, step] of steps) {
        try {
          step();
        } catch (error) {
          console.error(`[shutdown] recording hub: ${name} failed to dispose`, error);
        }
      }
    },
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
      // files stay on disk, and a cursor track still resolving for one of them must not start.
      for (const id of writer.ids()) markEnded(id);
      bubbleProtection.reset();
      cameraBubble.applyProtection();
      releaseParkedBubble();
      for (const [sessionId] of recordingLeases) markEnded(sessionId);
      // A take still being created (or finalized) ends once that settles, holding the vault
      // until then; an export's partial is discarded, a recording's kept, as for a reload.
      for (const [sessionId, take] of recordingLeases) {
        void endTake(sessionId, take, abandonCleanup(take)).catch((error) =>
          console.error("releasing a take failed", error),
        );
      }
      // Sessions no take holds any more (a stranded take waiting for its abort).
      for (const id of writer.ids()) {
        if (recordingLeases.has(id)) continue;
        void writer.release(id).catch((error) => console.error("releasing a take failed", error));
      }
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
