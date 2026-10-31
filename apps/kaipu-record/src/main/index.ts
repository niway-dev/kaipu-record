import { app, shell, dialog, BrowserWindow, ipcMain, Notification, screen, Tray } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types";
import icon from "../../resources/icon.png?asset";
import { CapturePanelWindow } from "./capture-panel-window";
import { devAppIdentity } from "./app-identity";
import { appShutdown, installAppShutdown } from "./app-shutdown";
import { createMainTranslator } from "@kaipu/i18n/main";
import {
  createTray,
  rebuildTrayMenu,
  setTrayCountdown,
  setTrayRecording,
  setTrayState,
  type TrayState,
} from "./tray";
import { ROUTES } from "@shared/routes";
import { registerRecordingSourceHandlers } from "./recording-sources";
import { registerPermissionHandlers } from "./permissions";
import { broadcastLibraryChanged, currentVault, registerLibraryVaultHandlers } from "./library";
import { cleanupDragCopies, cleanupLegacyDragCopies } from "./library/drag-copies";
import { registerCloudStorageHandlers } from "./cloud";
import { registerMediaProtocol, registerMediaScheme } from "./media-protocol";
import { registerRecordingHub, type RecordingHubHandle } from "./recording/recording-hub";
import { recoverStrandedRecordings } from "./recording/stranded-recordings";
import { proceedWhenRecordingStops } from "./recording/stop-guard";
import { beginRecordTiming, markRecordTiming } from "./recording/record-timing";
import {
  activeWorkspace,
  attachWindowTitle,
  availableWorkspacePaths,
  initWorkspaces,
  notifyWorkspaceBusyChanged,
  registerWorkspaceHandlers,
} from "./workspaces";
import {
  initAutoUpdater,
  getUpdateStatus,
  installDownloadedUpdate,
  checkForUpdatesNow,
} from "./updater/auto-updater";
import {
  registerSettings,
  getDeviceId,
  getAppSettings,
  applyDockPolicy,
  onSettingsChanged,
  onSettingsKeysChanged,
  updateAppSettings,
} from "./infrastructure/settings-store";
import { registerAuth } from "./infrastructure/auth-store";
import { createBrowserSignInClient } from "./services/browser-sign-in";
import { createDeepLinkRouter } from "./deep-link-router";
import { DEEP_LINK_SCHEME } from "./services/deep-link";
import {
  registerGlobalShortcuts,
  applyGlobalShortcuts,
  getShortcutStatus,
  unregisterGlobalShortcuts,
} from "./shortcuts/global-shortcuts";
import {
  initMainAnalytics,
  setMainAnalyticsEnabled,
  shutdownMainAnalytics,
} from "./services/analytics.service";
import { registerAnalyticsIpc } from "./services/analytics-ipc";
import {
  isCaptureMode,
  isEnabledCaptureMode,
  type CaptureMode,
  type CaptureRequestPayload,
} from "@shared/types/screenshot-capture";
import type { RecordTarget } from "./screenshots/capture-handler";
import {
  disposeCaptureOverlay,
  prewarmCaptureOverlay,
  registerScreenshotHandlers,
  type ScreenshotHandlers,
} from "./screenshots/screenshot-ipc";
import { resolveShortcutCapture, type CaptureShortcut } from "./screenshots/shortcut-capture";
import { routeCaptureRequest } from "./screenshots/capture-request";
import {
  createCaptureToastWindow,
  saveFromToast,
  type CaptureToastWindow,
} from "./screenshots/capture-toast-window";
import { createCaptureWindowHooks } from "./screenshots/capture-window-hooks";
import {
  clearLastQuietCapture,
  peekLastQuietCapture,
  releaseLastQuietCapture,
  takeLastQuietCapture,
  type QuietCapture,
} from "./screenshots/last-quiet-capture";
import { saveCaptureToWorkspace } from "./screenshots/screenshot-save";
import { screenshotTitle } from "@shared/screenshot-title";
import {
  boundsAroundCenter,
  fitPresetToDisplay,
  isEditorPreset,
  WINDOW_PRESETS,
  type WindowPresetName,
} from "@shared/window-size";
import {
  handleMainWindowClose,
  isQuitShortcut,
  secondInstanceAction,
  shouldQuitOnAllWindowsClosed,
  shouldShowTrayHint,
} from "./window-close-policy";

let mainWindow: BrowserWindow | null = null;
let capturePanel: CapturePanelWindow | null = null;
let tray: Tray | null = null;
/** Assigned once `registerRecordingHub` runs inside `app.whenReady`; read
 *  through this closure by handlers defined above that point in the file. */
let hub: RecordingHubHandle | null = null;
/** True while the main window is closing itself after the user confirmed
 *  "Stop and close" on the mid-recording close guard — lets the `close`
 *  listener below allow that specific close through without re-prompting. */
let closingWithRecording = false;
/** True once the user confirmed "Stop and quit" on the mid-recording quit
 *  guard — lets the second `before-quit` (after the recording finalizes) pass
 *  straight through instead of prompting again. */
let quittingWithRecording = false;
/** Mirrors the renderer's `exportActive` message: true while a video export is writing. */
let exportActive = false;
/** True once the user confirmed "Cancel export and close" — lets the second `close` pass. */
let closingWithExport = false;
/** Same, for "Cancel export and quit" on `before-quit`. */
let quittingWithExport = false;
/** True once `before-quit` passed every guard: the app is really quitting, so the
 *  main window's `close` must close it rather than hide it to the tray (Windows). */
let isQuitting = false;
/** Set true when the renderer sends `appReady` (its IPC listeners are up), reset
 *  to false whenever a new main window is created. */
let rendererReady = false;
/** Window-triggered actions (start/capture/source-picker) that arrived before the
 *  renderer was ready, flushed on `appReady` so they aren't dropped. */
let pendingRendererSends: Array<{ channel: string; payload?: unknown }> = [];

/**
 * Send a main → renderer channel, or queue it until the renderer signals ready.
 * Fixes the race where a freshly-created window's `did-finish-load` fires before
 * the app shell's React effects register the matching IPC listeners, so the
 * message was silently dropped (the shortcut "did nothing" the first time).
 */
function sendToRenderer(channel: string, payload?: unknown): void {
  const contents = mainWindow?.webContents;
  if (!contents) return;
  if (rendererReady) contents.send(channel, payload);
  else pendingRendererSends.push({ channel, payload });
}

// A dev run is a different app from the installed one: its own name and userData directory,
// so it gets its own lock, session, settings and device id (see app-identity.ts). Must run
// before the lock below and before anything reads userData.
const devIdentity = devAppIdentity({
  isPackaged: app.isPackaged,
  hasUserDataDirSwitch: app.commandLine.hasSwitch("user-data-dir"),
  appDataDir: app.getPath("appData"),
});
if (devIdentity) {
  app.setName(devIdentity.name);
  if (devIdentity.userDataDir) app.setPath("userData", devIdentity.userDataDir);
}

// One running copy per user. Mandatory on Windows: closing the window hides the app
// to the tray instead of quitting, so double-clicking the desktop shortcut afterwards
// would otherwise start a second process — a second tray icon, global shortcuts that
// fail to register because the first copy holds them, and two writers on the same
// settings file. The second copy quits before creating any window; the first one is
// told through `second-instance` and brings its window back. The lock is keyed on the
// userData directory, so E2E launches with their own `--user-data-dir` do not collide.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// `kaipu://` links (browser sign-in hand-back, later billing) reach the app three ways, and all
// of them go through this one router: macOS `open-url`, the argv of a cold start (Windows and
// Linux), and the argv of a second launch (`second-instance`, below). The lock above is the
// only one in the process: @better-auth/electron's `setupMain` is deliberately NOT used because
// it calls `requestSingleInstanceLock` and registers its own `second-instance` handler, which
// would focus the window even while a recording hides it (see `secondInstanceAction`).
// `completeSignIn` is bound once the auth store exists, inside `app.whenReady`.
let completeBrowserSignIn: (code: string) => Promise<unknown> = async () => {};
const deepLinks = createDeepLinkRouter({
  completeSignIn: (code) => completeBrowserSignIn(code),
  focus: () => {
    if (!hub?.isActive()) showMainWindow();
  },
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Only a packaged build owns the scheme. A dev run is Electron's own bundle: registering it
  // would, on Windows, replace the installed app as the handler of every kaipu:// link, and
  // macOS does not route custom schemes to unpackaged apps anyway. Dev uses the paste-code
  // fallback instead. (Packaged builds also get the scheme from electron-builder `protocols`.)
  if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);

  // macOS, including a cold start by link, which fires this before `ready`.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deepLinks.receive(url);
  });
  // Windows/Linux cold start: the link is in our own argv.
  deepLinks.receiveArgv(process.argv);

  app.on("second-instance", (_event, argv) => {
    deepLinks.receiveArgv(argv);
    const action = secondInstanceAction({ ready: app.isReady(), recording: !!hub?.isActive() });
    if (action === "show") showMainWindow();
    else if (action === "notify") showAlreadyRecordingNotice();
  });
}

// Must run before `app.whenReady` — privileged scheme registration.
registerMediaScheme();
// `will-quit` disarms the quit deadline; a window created after the quit began is destroyed.
installAppShutdown();

/** Normal window minimums; floored so the main UI / onboarding never break. */
const BASE_MIN_WIDTH = 720;
/** How long after the main window shows the capture overlay's windows start loading hidden. */
const OVERLAY_PREWARM_AFTER_LAUNCH_MS = 3000;
const BASE_MIN_HEIGHT = 560;
/** The screenshot editor (toolbar + canvas + beautify panel) needs more room. */
/**
 * The first-run takeover. Its content does not reflow — a 96px brand mark, a
 * headline, a two-line subtitle and a 2x2 grid of permission cards — so under
 * this floor the step stops being a page and turns into a scroll well with the
 * footer buttons pushed out of reach. Width is the base floor (the step is
 * capped at 640px plus gutters); only the height needs raising.
 */
const ONBOARDING_MIN_WIDTH = BASE_MIN_WIDTH;
const ONBOARDING_MIN_HEIGHT = 700;

/** Ask the renderer to cancel its export, then run `done` once it reports the export stopped
 *  (`exportActive: false`) or after 2 s, whichever comes first. */
function cancelExportThen(done: () => void): void {
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    // Whatever won, the confirmed cancel is final: don't let the guards prompt a second time.
    exportActive = false;
    clearTimeout(timeout);
    ipcMain.removeListener(IPC_CHANNELS.exportActive, onActive);
    done();
  };
  const onActive = (_event: unknown, active: unknown): void => {
    if (active !== true) finish();
  };
  const timeout = setTimeout(finish, 2000);
  ipcMain.on(IPC_CHANNELS.exportActive, onActive);
  mainWindow?.webContents.send(IPC_CHANNELS.exportCommand, "cancel");
}

/**
 * Create the main window. `showOnReady` defaults to true; pass false when
 * recreating it solely to run the capture flow (the renderer reveals it after a
 * successful shot), so the app doesn't flash to the front and into the capture.
 */
function createWindow(showOnReady = true): void {
  // A fresh window's renderer hasn't registered its IPC listeners yet; block
  // sends until it signals `appReady`.
  rendererReady = false;
  exportActive = false;
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: "Kaipu Record",
    width: 900,
    height: 670,
    minWidth: BASE_MIN_WIDTH,
    minHeight: BASE_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  // "Work — Kaipu Record" once a second workspace exists; follows every switch.
  attachWindowTitle(mainWindow);
  // The recorder lives in this renderer: a stall shows in the terminal, take or not.
  mainWindow.on("unresponsive", () => console.warn("[record-timing] main window unresponsive"));
  mainWindow.on("responsive", () => console.warn("[record-timing] main window responsive again"));

  mainWindow.on("ready-to-show", () => {
    if (showOnReady) mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closingWithRecording = false;
    closingWithExport = false;
    exportActive = false;
    // A window closed mid-countdown takes its renderer, and the take with it. Release the
    // pending take (tray, Esc, shade) here; the user closed the window, so do not reopen it.
    hub?.forceReset();
  });

  // Closing the window mid-recording (the red button, or Cmd+W where the app
  // stays alive in the tray) would otherwise orphan the recording: the bar
  // sticks around with a frozen timer, the Dock policy is never restored, and
  // the Capture Panel stays locked until app restart. Confirm, then run the
  // recorder's normal stop path (finalizing what's on disk so far) before
  // actually closing — with a timeout so the window is never stuck if the
  // renderer is unresponsive.
  //
  // Each guard returns whether it took this close over (prevented it), so the
  // close-to-tray step below never hides over a guard's confirmation.
  const recordingCloseGuard = (event: Electron.Event): boolean => {
    if (closingWithRecording || !hub?.isActive()) return false;
    event.preventDefault();
    const t = createMainTranslator(getAppSettings().locale);
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: "warning",
      buttons: [t("dialogs.cancel"), t("dialogs.stopAndClose")],
      defaultId: 0,
      cancelId: 0,
      message: t("dialogs.recordingInProgress"),
      detail: t("dialogs.closeStopsDetail"),
    });
    if (choice !== 1) {
      // Cancelling here aborts a quit already past `before-quit`, if one was in
      // flight: the app keeps running, so the next close must hide again.
      isQuitting = false;
      return true;
    }
    closingWithRecording = true;
    mainWindow?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
    proceedWhenRecordingStops({
      ipc: ipcMain,
      channel: IPC_CHANNELS.recordingStop,
      timeoutMs: 5000,
      // The renderer hung: no `recordingStop` will come, so the hub would stay "recording".
      onTimeout: () => hub?.forceReset(),
      proceed: () => mainWindow?.close(),
    });
    return true;
  };

  // The export runs in this window's renderer, so closing the window destroys it mid-write and
  // leaves a `.part` file behind. Confirm, then ask the renderer to cancel (it deletes the
  // `.part`) and close once it reports the export stopped — with a timeout so the window is
  // never stuck. The recording guard above has priority and returns first.
  const exportCloseGuard = (event: Electron.Event): boolean => {
    if (closingWithExport || !exportActive || hub?.isActive()) return false;
    event.preventDefault();
    const t = createMainTranslator(getAppSettings().locale);
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: "warning",
      buttons: [t("dialogs.cancel"), t("dialogs.cancelExportAndClose")],
      defaultId: 0,
      cancelId: 0,
      message: t("dialogs.exportInProgress"),
      detail: t("dialogs.closeCancelsExportDetail"),
    });
    if (choice !== 1) {
      // Cancelling here aborts a quit already past `before-quit`, if one was in
      // flight: the app keeps running, so the next close must hide again.
      isQuitting = false;
      return true;
    }
    closingWithExport = true;
    cancelExportThen(() => mainWindow?.close());
    return true;
  };

  // Windows keeps the app in the tray: a close the guards let through hides the
  // window instead, unless the app is quitting. A confirmed "Stop and close" /
  // "Cancel export and close" re-closes with its flag set, passes the guards, and
  // lands here — so on Windows it hides too. macOS and Linux close as before.
  mainWindow.on("close", (event) => {
    const guardTookOver = recordingCloseGuard(event) || exportCloseGuard(event);
    handleMainWindowClose(
      event,
      { platform: process.platform, isQuitting, guardTookOver },
      hideMainWindowToTray,
    );
  });

  // Windows: Ctrl+Q quits, as the tray menu's Quit does (the hidden menu bar binds nothing).
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!isQuitShortcut(input, process.platform)) return;
    event.preventDefault();
    app.quit();
  });

  // Windows log-off / shutdown ends the app without `before-quit`; let the close through.
  mainWindow.on("session-end", () => {
    isQuitting = true;
  });

  // If the renderer crashes/OOMs mid-recording there is no `recordingStop` IPC
  // coming — without this the hub's activity would stay "active" forever (bar
  // stuck, Dock policy never restored, Capture Panel permanently locked).
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("main renderer process gone", details.reason);
    hub?.forceReset({ revealAbandoned: true });
    // The renderer that owned the export is gone; nothing is left to cancel.
    exportActive = false;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/**
 * Hide the main window in place of closing it (Windows close-to-tray). Clears the
 * guards' one-shot "closing" flags the way `closed` would, so the next close while
 * recording or exporting asks again. The first time, tell the user the app is still
 * running with a native notification — shown now, as the window disappears, because
 * that is the moment they might think the app quit. The flag is persisted only once
 * the notification was actually shown.
 */
function hideMainWindowToTray(): void {
  closingWithRecording = false;
  closingWithExport = false;
  mainWindow?.hide();
  const settings = getAppSettings();
  if (
    !shouldShowTrayHint({
      platform: process.platform,
      trayHintShown: settings.trayHintShown,
      notificationSupported: Notification.isSupported(),
    })
  ) {
    return;
  }
  const t = createMainTranslator(settings.locale);
  new Notification({
    title: t("tray.closedToTrayTitle"),
    body: t("tray.closedToTrayBody"),
  }).show();
  updateAppSettings({ trayHintShown: true });
}

/** Show & focus the main window, recreating it if it was closed. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Open the main window and tell its Record page to start (recording runs in the
 * main renderer, not the transparent panels). Shared by the Capture Panel's
 * Start button and the global "Start recording" shortcut. The Record page's
 * `startRecording` guards on a selected source / not-already-recording.
 */
function showAlreadyRecordingNotice(): void {
  if (!Notification.isSupported()) return;
  const t = createMainTranslator(getAppSettings().locale);
  new Notification({
    title: t("dialogs.alreadyRecordingTitle"),
    body: t("dialogs.alreadyRecordingBody"),
  }).show();
}

function triggerStartRecording(options: { reveal?: boolean } = {}): void {
  if (hub?.isActive()) {
    // Don't un-hide the (deliberately hidden) main window into an active
    // recording — it would get burned into the video with no explanation.
    // Let the user know the shortcut landed instead of silently no-oping.
    capturePanel?.hide();
    showAlreadyRecordingNotice();
    return;
  }
  // A direct start (Capture Panel, no overlay) begins its timeline here; an overlay start
  // began it at the selector.
  if (options.reveal === false) markRecordTiming("start request sent to the recorder");
  else beginRecordTiming("start requested (no overlay)");
  capturePanel?.hide();
  if (options.reveal === false) {
    // The countdown runs on the region the overlay chose (the recording shade); the
    // recorder lives in the main window, which must exist but stays out of sight.
    if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
  } else {
    showMainWindow();
  }
  sendToRenderer(IPC_CHANNELS.recordingRequestStart);
}

/**
 * "Start recording" (Record page, tray, the `startRecording` shortcut) and the mode chips:
 * open the selector, the capture overlay with the `record` intent, in `requested` or in the
 * last used mode (design "Kaipu Record Modes"). A chip also makes its mode the last used one.
 * Window has no overlay picker while NIW2-469 keeps it off, so it opens the thumbnail picker
 * on the Record page, which starts the countdown once a window is picked.
 */
function triggerRecordSelector(requested?: CaptureMode): void {
  // A pending take (countdown) is refused like an active one: a second overlay would land in
  // the video, and the hub's held Esc would cancel the countdown instead of the overlay.
  if (hub?.isActive() || hub?.isPending()) {
    capturePanel?.hide();
    showAlreadyRecordingNotice();
    return;
  }
  beginRecordTiming(`start clicked (${requested ?? "last"} mode)`);
  const settings = getAppSettings();
  if (requested && requested !== settings.recordingMode) {
    updateAppSettings({ recordingMode: requested });
  }
  const mode = requested ?? settings.recordingMode;
  capturePanel?.hide();
  if (!isEnabledCaptureMode(mode)) {
    showMainWindow();
    sendToRenderer(IPC_CHANNELS.recordingRequestSourcePicker, { startOnPick: true });
    return;
  }
  // The Record answer needs the display's screen source: list them while the overlay opens.
  hub?.prefetchScreenSources();
  triggerCaptureScreenshot({ mode, intent: "record" });
}

/**
 * Open the main window and tell its Record page to open the source picker — the
 * Capture Panel's "Change" button (the panel can't pick a screen; the picker + source
 * enumeration live in the main renderer). Mirrors `triggerStartRecording`.
 */
function triggerChooseSource(): void {
  capturePanel?.hide();
  showMainWindow();
  sendToRenderer(IPC_CHANNELS.recordingRequestSourcePicker);
}

/**
 * Show the main window on a route. The renderer uses a hash router, so changing the
 * hash navigates in place without a reload. A window that had to be recreated is
 * still loading, so the hash is set once it has finished.
 */
function showMainWindowAt(route: string): void {
  const recreated = !mainWindow || mainWindow.isDestroyed();
  showMainWindow();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const go = (): void => {
    void win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify("#" + route)}`);
  };
  if (recreated || win.webContents.isLoading()) win.webContents.once("did-finish-load", go);
  else go();
}

/** Bring the app back to the foreground from any state (the rescue shortcut). */
function bringAppToFront(): void {
  showMainWindow();
  applyDockPolicy();
  app.focus({ steal: true });
}

/**
 * Triggered by the global `⌘⌃X` hotkey. Just broadcasts `screenshot:hotkey` so the
 * AppShell runs `useScreenshotCapture().capture()`. It deliberately does NOT bring
 * the window forward: the native `screencapture` region selector floats above
 * everything, and `screenshotCapture` then hides the app so it isn't in the shot
 * (see `captureWindowHooks`). The window comes back via `revealAfterCapture`. A recording in
 * progress is refused here with a system notification (see `routeCaptureRequest`).
 */
function triggerCaptureScreenshot(request: CaptureRequestPayload): void {
  routeCaptureRequest({
    isRecordingActive: () => (hub?.isActive() || hub?.isPending()) ?? false,
    notifyBusy: () => {
      // The main window is hidden during a take, so the renderer cannot show its
      // "finish the recording first" toast — use a system notification.
      if (!Notification.isSupported()) return;
      const t = createMainTranslator(getAppSettings().locale);
      new Notification({
        title: t("dialogs.captureWhileRecordingTitle"),
        body: t("screenshots.captureWhileRecording"),
      }).show();
    },
    forwardToRenderer: () => {
      // The capture flow runs in the renderer, so the window must exist. If it was
      // closed (macOS keeps the app alive in the tray), recreate it HIDDEN — never
      // show a hidden one: the capture handler hides the window anyway, and bringing
      // it forward here would put the app back in the shot. The renderer reveals it
      // after a successful capture.
      if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
      sendToRenderer(IPC_CHANNELS.screenshotHotkey, request);
    },
  });
}

/**
 * The overlay chose what to record (ADR 0030). Record starts the take through the same path
 * as the tray's Start; Use selection only sets the target, and opens the tray panel when the
 * app is out of sight, so the choice is visible next to the Record button. A take already
 * running is never touched.
 */
async function applyRecordTarget(target: RecordTarget): Promise<void> {
  if (!hub) return;
  if (hub.isActive()) {
    showAlreadyRecordingNotice();
    return;
  }
  markRecordTiming(`overlay answered (${target.start ? "record" : "use selection"})`);
  const applied = await hub.selectArea(target.displayId, target.rect, target.ratio);
  if (!applied) {
    // The overlay kept the main window hidden for a countdown that will not come: bring the
    // app back, so a pick that failed (display gone, area too small) is never silent.
    if (target.start) showMainWindow();
    return;
  }
  // What the user recorded with is what "Start recording" opens next time.
  const mode: CaptureMode = target.rect ? "frame" : "screen";
  if (getAppSettings().recordingMode !== mode) updateAppSettings({ recordingMode: mode });
  if (target.start) {
    // If the recorder never starts (a dialog in the hidden window, no source, not idle) or
    // the countdown is cancelled, the hidden app comes back instead of staying out of sight.
    hub.prepareRegionCountdown(target.displayId, target.rect, showMainWindow);
    // The renderer is not told the target: `selectArea` broadcast it as settings, and the
    // recorder reads source and area when its countdown ends, not when the request lands; an
    // acquisition it made during the countdown with an older target is released (recorder-store
    // test "resolves the take's input again when the countdown ends"). A start path without a
    // countdown must carry the target in the request instead.
    triggerStartRecording({ reveal: false });
    return;
  }
  const mainVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  if (!mainVisible && tray && capturePanel) capturePanel.show(tray.getBounds());
}

/** The `recordArea` shortcut: the overlay in Frame, opened to choose what to record. */
function triggerRecordArea(): void {
  beginRecordTiming("record area shortcut");
  hub?.prefetchScreenSources();
  triggerCaptureScreenshot({ mode: "frame", intent: "record" });
}

/** Set once the screenshot IPC is registered; until then a shortcut trusts the stored mode. */
let screenshotHandlers: ScreenshotHandlers | null = null;

/**
 * A capture shortcut: the generic one opens the overlay in the current mode, a
 * mode-specific one in its own. The mode becomes current only when a capture in it
 * succeeds (the capture handler remembers it). See `resolveShortcutCapture`.
 */
function triggerShortcutCapture(action: CaptureShortcut): void {
  const { mode } = resolveShortcutCapture(
    action,
    getAppSettings().screenshotMode,
    screenshotHandlers?.supportedModes() ?? null,
  );
  triggerCaptureScreenshot({ mode });
}

/** The toast after a quiet capture; created once the app is ready. */
let captureToast: CaptureToastWindow | null = null;

/** Window orchestration handed to the screenshot IPC (hide for the shot, reveal after). */
const captureWindowHooks = createCaptureWindowHooks({
  mainWindow: () => mainWindow,
  hideCapturePanel: () => capturePanel?.hide(),
  dismissToast: () => captureToast?.dismiss(),
  hideCameraBubble: () => hub?.hideCameraBubbleForCapture(),
  restoreCameraBubble: () => hub?.restoreCameraBubbleAfterCapture(),
  showMainWindow,
  bringAppToFront,
});

/**
 * The capture toast asked the main window for a saved screenshot (Annotate, Open in
 * Library). Routes are keyed by asset id, the toast knows the vault id: resolve it, then
 * let the renderer navigate and reveal the window itself (`revealAfterCapture`), so it
 * comes back already on the item — the same hand-off as the capture hotkey.
 */
function openSavedScreenshot(target: "editor" | "library", id: string): void {
  void currentVault()
    .describe(id)
    .then((item) => {
      if (!item) {
        console.warn(`[screenshot] toast: ${id} is no longer in the vault`);
        return;
      }
      if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
      sendToRenderer(IPC_CHANNELS.screenshotOpenSaved, { target, assetId: item.assetId });
    })
    .catch((error: unknown) => console.error("[screenshot] toast: open saved failed", error));
}

/** Annotate on a copy-only toast: hand the kept bytes to the editor (it reveals the window). */
function openQuietCapture(capture: QuietCapture): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
  const { png, width, height, mode } = capture;
  sendToRenderer(IPC_CHANNELS.screenshotOpenQuietCapture, {
    png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    width,
    height,
    mode,
  });
}

/** Drag copies of every connected workspace (startup and quit); best-effort. */
async function cleanupDragCopiesEverywhere(): Promise<void> {
  for (const path of await availableWorkspacePaths().catch(() => [])) {
    await cleanupDragCopies(path).catch(() => {});
  }
}

/** Stranded takes of every connected workspace, each into its own folder. */
async function recoverStrandedEverywhere(): Promise<void> {
  const title = createMainTranslator(getAppSettings().locale)("library.recoveredRecordingTitle");
  const active = activeWorkspace().path;
  for (const vaultDir of await availableWorkspacePaths().catch(() => [])) {
    try {
      const r = await recoverStrandedRecordings({
        vaultDir,
        ...(vaultDir === active ? { fallbackTempDir: app.getPath("temp") } : {}),
        title,
      });
      if (r.recovered.length) console.info(`recovered ${r.recovered.length} stranded recording(s)`);
      if (r.failed.length) console.warn("stranded recordings left in place", r.failed);
    } catch (error) {
      console.error("stranded recording sweep failed", error);
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // A second copy is already quitting (see the single-instance lock above).
  if (!hasSingleInstanceLock) return;

  // The workspace registry first (ADR 0032): the first launch after the upgrade migrates
  // the library into "Default workspace", and every window's preload reads the stamp.
  await initWorkspaces();

  // Set app user model id for windows
  electronApp.setAppUserModelId("com.niway.kaipu-record");

  // A dev run is Electron's own bundle, so the Dock and ⌘-Tab would show
  // Electron's icon. Give it the brand icon (derived by scripts/generate-app-icons.sh).
  // Packaged builds keep the bundle's .icns: overriding it there would hide a
  // stale bundle icon instead of surfacing it.
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(icon);

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Drag copies left by a previous run (crash, force quit) are stale; best-effort, in every
  // workspace that is connected.
  void cleanupDragCopiesEverywhere();
  cleanupLegacyDragCopies(app.getPath("temp")).catch(() => {});

  // The renderer reports when a video export starts and stops (NIW2-218); the close and quit
  // guards read it. Registered once, not per window.
  ipcMain.on(IPC_CHANNELS.exportActive, (_event, active: unknown) => {
    exportActive = active === true;
    notifyWorkspaceBusyChanged();
  });

  // IPC test
  ipcMain.on("ping", () => console.log("pong"));

  // The app shell finished mounting and registered its IPC listeners — flush any
  // window-triggered actions that arrived while it was still loading.
  ipcMain.on(IPC_CHANNELS.appReady, (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    rendererReady = true;
    const queued = pendingRendererSends;
    pendingRendererSends = [];
    for (const { channel, payload } of queued) mainWindow?.webContents.send(channel, payload);
  });

  // Persisted app settings (+ apply the Dock/switcher policy and launch-at-login).
  registerSettings();
  // Checked explicitly rather than asserted non-null: an unset value would otherwise reach
  // auth-client as `undefined` in the request URL and surface much later as a generic "network"
  // error the user cannot act on. Fail loudly at startup, naming the variable.
  const authServerUrl = import.meta.env.MAIN_VITE_SERVER_URL;
  if (!authServerUrl) throw new Error("MAIN_VITE_SERVER_URL is not set — check .env");
  // The website origin that hosts the browser sign-in page. Not fatal when missing: the app
  // still runs, and starting a sign-in reports "not configured" instead of failing silently.
  const webUrl = import.meta.env.MAIN_VITE_WEB_URL;
  let browserSignIn: ReturnType<typeof createBrowserSignInClient> | undefined;
  try {
    if (!webUrl) throw new Error("MAIN_VITE_WEB_URL is not set — check .env");
    browserSignIn = createBrowserSignInClient({
      serverUrl: authServerUrl.replace(/\/$/, ""),
      webUrl: new URL(webUrl).origin,
    });
  } catch (error) {
    console.error("browser sign-in is disabled", error);
  }
  const auth = registerAuth({ serverUrl: authServerUrl }, () => mainWindow, {
    browser: browserSignIn,
    sendToRenderer,
  });
  completeBrowserSignIn = auth.completeBrowserSignIn;
  deepLinks.start();
  initMainAnalytics(getDeviceId(), getAppSettings().diagnosticsEnabled);
  onSettingsChanged((settings) => setMainAnalyticsEnabled(settings.diagnosticsEnabled));
  registerAnalyticsIpc();

  // Capture Panel → show the main window (the panel's "Open ↗" button).
  ipcMain.on("capture-panel:open-main", () => {
    capturePanel?.hide();
    showMainWindow();
  });

  // Capture Panel "Start" → open the main window and tell its Record page to start.
  ipcMain.on(IPC_CHANNELS.recordingRequestStart, () => triggerStartRecording());

  // Record page / Capture Panel "Start recording" or a mode chip → open the selector.
  ipcMain.on(IPC_CHANNELS.recordingRequestSelector, (_event, request?: { mode?: unknown }) => {
    triggerRecordSelector(isCaptureMode(request?.mode) ? request.mode : undefined);
  });

  // Capture Panel "Change" → open the main window and open its source picker.
  ipcMain.on(IPC_CHANNELS.recordingRequestSourcePicker, triggerChooseSource);

  // Capture Panel "Capture Screen" → dismiss the panel and run the same interactive
  // region capture as the ⌘⌃X hotkey.
  ipcMain.on(IPC_CHANNELS.screenshotRequestCapture, (_event, request?: { mode?: unknown }) => {
    capturePanel?.hide();
    triggerCaptureScreenshot({ mode: isCaptureMode(request?.mode) ? request.mode : "frame" });
  });

  // App version for the renderer-side version gate.
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

  // Per-action registration state of the global shortcuts (for the Settings UI).
  ipcMain.handle(IPC_CHANNELS.shortcutsGetStatus, () => getShortcutStatus());
  // While the Settings UI captures a new binding, release the global shortcuts so
  // the combo reaches the renderer (and doesn't fire the action being rebound).
  // `resume` only arrives from the React effect cleanup — if the window is closed
  // (Cmd+W) while still "listening", that cleanup never runs, so ALL global
  // shortcuts (including the ⌘⌃O rescue) would stay dead until a settings change
  // or relaunch. Re-register when the suspending window is destroyed as a backstop.
  let shortcutsSuspendedBy: Electron.WebContents | null = null;
  ipcMain.on(IPC_CHANNELS.shortcutsSuspend, (event) => {
    unregisterGlobalShortcuts();
    if (shortcutsSuspendedBy !== event.sender) {
      shortcutsSuspendedBy = event.sender;
      event.sender.once("destroyed", () => {
        if (shortcutsSuspendedBy === event.sender) {
          applyGlobalShortcuts();
          shortcutsSuspendedBy = null;
        }
      });
    }
  });
  ipcMain.on(IPC_CHANNELS.shortcutsResume, () => {
    applyGlobalShortcuts();
    shortcutsSuspendedBy = null;
  });

  // Recording: screen/window source enumeration.
  registerRecordingSourceHandlers();

  // Recording engine: disk writer, control-bar window, state relay.
  hub = registerRecordingHub(
    () => mainWindow,
    (activity) => setTrayRecording(activity.active),
    setTrayCountdown,
  );

  // Global (system-wide) shortcuts. Reuse the existing start/stop paths so the
  // recorder logic stays in one place. Re-register when the bindings change.
  registerGlobalShortcuts({
    getShortcuts: () => getAppSettings().shortcuts,
    handlers: {
      // "Start recording" opens the selector in the last used mode, as the button does.
      startRecording: () => triggerRecordSelector(),
      stopRecording: () => {
        markRecordTiming("stop shortcut: stop sent to the recorder");
        mainWindow?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
      },
      bringToFront: bringAppToFront,
      captureScreenshot: () => triggerShortcutCapture("captureScreenshot"),
      captureScreen: () => triggerShortcutCapture("captureScreen"),
      captureFrame: () => triggerShortcutCapture("captureFrame"),
      captureWindow: () => triggerShortcutCapture("captureWindow"),
      recordArea: triggerRecordArea,
      // Live input toggles write the shared RecordingSettings, never the engine:
      // mid-take the recorder forwards the change, outside a take it is just the
      // pre-recording toggle.
      toggleMicrophone: () => hub?.toggleRecordingSetting("isMicrophoneEnabled"),
      toggleSystemAudio: () => hub?.toggleRecordingSetting("isSystemAudioEnabled"),
      toggleCamera: () => hub?.toggleRecordingSetting("isCameraEnabled"),
    },
  });
  onSettingsKeysChanged(["shortcuts"], () => applyGlobalShortcuts());
  // Rebuild the native tray menu when the language (or a shortcut it labels) changes.
  onSettingsKeysChanged(["locale", "shortcuts"], (settings) => rebuildTrayMenu(settings.locale));

  // Library: local recordings vault + cloud catalog.
  registerLibraryVaultHandlers({
    auth,
    serverUrl: authServerUrl,
    isExportActive: () => exportActive,
  });
  registerCloudStorageHandlers({ auth, serverUrl: authServerUrl });

  // Screenshots: capture/copy/save IPC handlers.
  // The capture toast after a quiet capture (lazy window; shown on the shot's display).
  const toast = createCaptureToastWindow({
    takeQuietCapture: takeLastQuietCapture,
    peekQuietCapture: peekLastQuietCapture,
    releaseQuietCapture: releaseLastQuietCapture,
    // manual: false — the editor never opened this shot, so it stays off the Continue list.
    // Bound to the workspace the capture started in: after a switch it writes nothing.
    saveToVault: saveFromToast(saveCaptureToWorkspace),
    title: () => screenshotTitle(),
    openSaved: openSavedScreenshot,
    openQuietCapture,
  });
  captureToast = toast;
  registerWorkspaceHandlers({
    busy: () => {
      if (hub?.isActive() || hub?.isPending()) return "recording";
      if (exportActive || hub?.hasOpenWrites()) return "exporting";
      return null;
    },
    dropPendingCaptures: () => {
      toast.dismiss();
      clearLastQuietCapture();
    },
    broadcastLibraryChanged,
  });
  screenshotHandlers = registerScreenshotHandlers(
    captureWindowHooks,
    (request) => toast.show(request),
    (target) => void applyRecordTarget(target),
  );

  /**
   * Raise the window's minimum size for a screen that cannot reflow, growing the
   * window when it is already smaller, and drop back to the base floor on exit.
   * Shared by the editors and the onboarding takeover — both want the same
   * behaviour with different numbers.
   */
  const setWindowFloor = (active: boolean, minWidth: number, minHeight: number): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!active) {
      mainWindow.setMinimumSize(BASE_MIN_WIDTH, BASE_MIN_HEIGHT);
      return;
    }
    // Never ask for more than the screen can give. On a 1440x900 display an
    // unclamped 1440x900 floor pins the window to the entire desktop, with no
    // room to move it and no way to shrink it.
    const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
    minWidth = Math.min(minWidth, workArea.width);
    minHeight = Math.min(minHeight, workArea.height);
    mainWindow.setMinimumSize(minWidth, minHeight);
    const bounds = mainWindow.getBounds();
    if (bounds.width < minWidth || bounds.height < minHeight) {
      const size = {
        width: Math.max(bounds.width, minWidth),
        height: Math.max(bounds.height, minHeight),
      };
      mainWindow.setBounds(boundsAroundCenter(bounds, size, workArea), true);
    }
  };

  /**
   * A screen declaring the window it wants. Both numbers matter: the size it
   * should be given, and the size below which it stops working.
   *
   * Order is not arbitrary. The minimum is lowered BEFORE a shrink, or the new
   * size is clamped back up by the old floor and leaving the editor leaves the
   * window editor-sized; it is raised AFTER a grow for the mirror reason.
   *
   * `setBounds(..., true)` animates on macOS, which is what keeps a 1440 -> 900
   * step from looking like a glitch.
   */
  /**
   * Apply the window a screen asks for.
   *
   * Sidebar screens all ask for `main`, and a repeat is a no-op, so navigating
   * between them never resizes: the window is the user's, and each screen lays
   * its content out inside it.
   *
   * An editor is the exception. Entering one remembers the bounds the user had
   * and grows the window; leaving restores exactly those bounds rather than a
   * preset, so an enlarged or carefully placed window survives a visit to the
   * editor.
   */
  let appliedPreset: WindowPresetName | null = null;
  let boundsBeforeEditor: Electron.Rectangle | null = null;

  ipcMain.on(IPC_CHANNELS.windowApplyPreset, (_event, name: WindowPresetName) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (name === appliedPreset) return;
    const previous = appliedPreset;
    appliedPreset = name;

    const area = screen.getDisplayMatching(mainWindow.getBounds()).workAreaSize;
    const { width, height, minWidth, minHeight, maxWidth, maxHeight } = fitPresetToDisplay(
      WINDOW_PRESETS[name],
      area,
    );
    // Cleared every time, so a limit cannot outlive the screen that set it.
    mainWindow.setMaximumSize(maxWidth ?? 0, maxHeight ?? 0);

    // Leaving an editor: put back what the user had, not what the preset says.
    if (previous !== null && isEditorPreset(previous) && !isEditorPreset(name)) {
      const restore = boundsBeforeEditor;
      boundsBeforeEditor = null;
      mainWindow.setMinimumSize(minWidth, minHeight);
      if (restore) {
        mainWindow.setBounds(restore, true);
        return;
      }
    }

    if (isEditorPreset(name) && !isEditorPreset(previous ?? "main")) {
      boundsBeforeEditor = mainWindow.getBounds();
    }

    // The first screen of the session gets its starting size; after that only an
    // editor changes it, and `main` already matches what is on screen.
    if (previous === null && !isEditorPreset(name)) {
      mainWindow.setMinimumSize(minWidth, minHeight);
      return;
    }
    if (!isEditorPreset(name)) {
      mainWindow.setMinimumSize(minWidth, minHeight);
      return;
    }

    // Growing into an editor: raise the floor after the size, or the old floor
    // would clamp nothing and the new one would fight the resize. Around the
    // window's centre, not from its top-left corner — `setSize` grows only right
    // and down. Leaving restores `boundsBeforeEditor`, position included.
    const current = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(current);
    mainWindow.setBounds(boundsAroundCenter(current, { width, height }, workArea), true);
    mainWindow.setMinimumSize(minWidth, minHeight);
  });

  // The menu bar mirrors the capture panel's selected mode.
  ipcMain.on(IPC_CHANNELS.traySetMode, (_event, mode: TrayState) => setTrayState(mode));

  // Onboarding mode: same treatment for the first-run takeover.
  ipcMain.on(IPC_CHANNELS.windowSetOnboardingMode, (_event, active: boolean) =>
    setWindowFloor(active, ONBOARDING_MIN_WIDTH, ONBOARDING_MIN_HEIGHT),
  );

  // Auto-update (packaged builds only). Silent download; renderer shows a restart banner.
  initAutoUpdater();
  ipcMain.handle(IPC_CHANNELS.updateGetStatus, () => getUpdateStatus());
  ipcMain.handle(IPC_CHANNELS.updateCheck, () => checkForUpdatesNow());
  ipcMain.on(IPC_CHANNELS.updateInstall, () => installDownloadedUpdate());

  // macOS media permissions (onboarding + settings).
  registerPermissionHandlers();

  // Stream local vault files to the renderer for playback (kaipu-media://).
  registerMediaProtocol();

  // Recover takes a failed finalize or a crash left behind, so the first Library list sees
  // them: in every connected workspace, each into its own folder. The OS temp fallback is
  // swept once, into the active one.
  void recoverStrandedEverywhere();

  createWindow();

  // Menu-bar tray + its Capture Panel.
  capturePanel = new CapturePanelWindow();
  tray = createTray(capturePanel, showMainWindow, getAppSettings().locale, {
    getShortcuts: () => getAppSettings().shortcuts,
    actions: {
      // Each Record item opens the selector in its own mode, as the Record page's chips do
      // (and makes it the last used one). Window opens the thumbnail picker while its
      // overlay mode is off (NIW2-469); a pick there starts the countdown.
      recordScreen: () => triggerRecordSelector("screen"),
      recordArea: () => triggerRecordSelector("frame"),
      recordWindow: () => triggerRecordSelector("window"),
      stopRecording: () => {
        markRecordTiming("tray menu: stop sent to the recorder");
        mainWindow?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
      },
      takeScreenshot: () => triggerShortcutCapture("captureScreenshot"),
      openLibrary: () => showMainWindowAt(ROUTES.library),
      openSettings: () => showMainWindowAt(ROUTES.settings),
    },
  });
  // Load the panel hidden so the first tray click does not pay a cold start. After
  // the main window is ready, not alongside it: the main window's start-up comes
  // first, and the end-to-end suite takes the first window to open as the app.
  mainWindow?.once("ready-to-show", () => capturePanel?.prewarm());
  // The capture overlay's windows too, a little later: "Start recording" opens them, and
  // loading one renderer per display was most of its wait. Held off while a take runs.
  let overlayPrewarm: ReturnType<typeof setTimeout> | null = null;
  mainWindow?.once("ready-to-show", () => {
    if (appShutdown.isQuitting()) return;
    overlayPrewarm = setTimeout(() => {
      overlayPrewarm = null;
      if (appShutdown.isQuitting()) return;
      prewarmCaptureOverlay(() => (hub?.isActive() || hub?.isPending()) ?? false);
      // The countdown's shade window too: it showed only after loading a renderer.
      hub?.prewarmShade();
    }, OVERLAY_PREWARM_AFTER_LAUNCH_MS);
  });

  // Everything pre-loaded above is released on quit, newest first (see shutdown.ts). The
  // pre-loads are what a quit used to trip over: a window loading, or a timer that created
  // one after the quit had already started closing windows.
  appShutdown.register({ name: "recording hub", dispose: () => hub?.dispose() });
  appShutdown.register({ name: "capture overlay", dispose: disposeCaptureOverlay });
  appShutdown.register({ name: "capture toast", dispose: () => captureToast?.destroy() });
  appShutdown.register({ name: "capture panel", dispose: () => capturePanel?.destroy() });
  appShutdown.register({
    name: "overlay prewarm timer",
    dispose: () => {
      if (overlayPrewarm) clearTimeout(overlayPrewarm);
      overlayPrewarm = null;
    },
  });

  app.on("activate", function () {
    // Dock-icon click: bring the main window back (recreating it if it was
    // closed). Keyed on the tracked mainWindow ref, NOT
    // getAllWindows().length === 0 — the Capture Panel and control-bar windows
    // persist hidden after their first use, so that count is never zero once
    // either has been shown, which left the Dock icon doing nothing.
    showMainWindow();
  });
});

// Cmd+Q / tray Quit mid-recording would otherwise leave an un-finalized .part in
// tmpdir (no moov box → unplayable) with no recovery flow. Guard it: confirm,
// then run the recorder's normal stop path so what's recorded so far is finalized
// to the vault before the app actually quits. A timeout still quits if the
// renderer is unresponsive, so the app is never wedged open.
app.on("before-quit", (event) => {
  // A second copy quitting at start-up owns nothing: it must not clean up the drag
  // copies, shortcuts or analytics of the copy that is running.
  if (!hasSingleInstanceLock) return;
  if (!quittingWithRecording && hub?.isActive()) {
    event.preventDefault();
    const t = createMainTranslator(getAppSettings().locale);
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      buttons: [t("dialogs.cancel"), t("dialogs.stopAndQuit")],
      defaultId: 0,
      cancelId: 0,
      message: t("dialogs.recordingInProgress"),
      detail: t("dialogs.quitStopsDetail"),
    });
    if (choice !== 1) return;
    quittingWithRecording = true;
    mainWindow?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
    proceedWhenRecordingStops({
      ipc: ipcMain,
      channel: IPC_CHANNELS.recordingStop,
      timeoutMs: 5000,
      onTimeout: () => hub?.forceReset(),
      proceed: () => app.quit(),
    });
    return;
  }

  // Same hazard as the window close guard, on Cmd+Q / tray Quit: quitting mid-export would
  // leave a `.part` behind. Confirm, cancel the export cleanly, then quit (2 s timeout). With
  // no main window there is no renderer running an export, so just quit.
  if (!quittingWithExport && exportActive && mainWindow) {
    event.preventDefault();
    const t = createMainTranslator(getAppSettings().locale);
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      buttons: [t("dialogs.cancel"), t("dialogs.cancelExportAndQuit")],
      defaultId: 0,
      cancelId: 0,
      message: t("dialogs.exportInProgress"),
      detail: t("dialogs.quitCancelsExportDetail"),
    });
    if (choice !== 1) return;
    quittingWithExport = true;
    cancelExportThen(() => app.quit());
    return;
  }

  // Every guard passed: this quit is real, so the main window's close must not hide it.
  isQuitting = true;

  // The app lives in the menu bar — keep the tray reference alive and release it
  // only on quit so the icon isn't garbage-collected. Flush analytics best-effort
  // (fire-and-forget: client already flushes on every capture so nothing is lost).
  unregisterGlobalShortcuts();
  tray?.destroy();
  tray = null;
  void cleanupDragCopiesEverywhere();
  void shutdownMainAnalytics();
  // Then everything the app pre-loaded or holds open, and the deadline behind it. From here
  // Electron only has the main window left to close; the rest was destroyed outright.
  appShutdown.begin();
});

// Quit when all windows are closed on Linux only. macOS keeps the app in the menu
// bar until Cmd+Q; Windows keeps it in the tray until its Quit item.
app.on("window-all-closed", () => {
  if (shouldQuitOnAllWindowsClosed(process.platform)) {
    app.quit();
  }
});
