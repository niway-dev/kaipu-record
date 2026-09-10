import { app, shell, dialog, BrowserWindow, ipcMain, Notification, Tray } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types";
import icon from "../../resources/icon.png?asset";
import { CapturePanelWindow } from "./capture-panel-window";
import { createMainTranslator } from "@kaipu/i18n/main";
import { createTray, rebuildTrayMenu } from "./tray";
import { registerRecordingSourceHandlers } from "./recording-sources";
import { registerPermissionHandlers } from "./permissions";
import { registerLibraryVaultHandlers } from "./library";
import { registerMediaProtocol, registerMediaScheme } from "./media-protocol";
import { registerRecordingHub, type RecordingHubHandle } from "./recording/recording-hub";
import { initAutoUpdater, getUpdateStatus, installDownloadedUpdate } from "./updater/auto-updater";
import {
  registerSettings,
  getDeviceId,
  getAppSettings,
  applyDockPolicy,
  onSettingsChanged,
} from "./infrastructure/settings-store";
import { registerAuth } from "./infrastructure/auth-store";
import {
  registerGlobalShortcuts,
  applyGlobalShortcuts,
  getShortcutStatus,
  unregisterGlobalShortcuts,
} from "./shortcuts/global-shortcuts";
import { initMainAnalytics, shutdownMainAnalytics } from "./services/analytics.service";
import { registerAnalyticsIpc } from "./services/analytics-ipc";
import { registerScreenshotHandlers } from "./screenshots/screenshot-ipc";

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
/** Set true when the renderer sends `appReady` (its IPC listeners are up), reset
 *  to false whenever a new main window is created. */
let rendererReady = false;
/** Window-triggered actions (start/capture/source-picker) that arrived before the
 *  renderer was ready, flushed on `appReady` so they aren't dropped. */
let pendingRendererSends: string[] = [];

/**
 * Send a main → renderer channel, or queue it until the renderer signals ready.
 * Fixes the race where a freshly-created window's `did-finish-load` fires before
 * the app shell's React effects register the matching IPC listeners, so the
 * message was silently dropped (the shortcut "did nothing" the first time).
 */
function sendToRenderer(channel: string): void {
  const contents = mainWindow?.webContents;
  if (!contents) return;
  if (rendererReady) contents.send(channel);
  else pendingRendererSends.push(channel);
}

// Must run before `app.whenReady` — privileged scheme registration.
registerMediaScheme();

/** Normal window minimums; floored so the main UI / onboarding never break. */
const BASE_MIN_WIDTH = 720;
const BASE_MIN_HEIGHT = 560;
/** The screenshot editor (toolbar + canvas + beautify panel) needs more room. */
const EDITOR_MIN_WIDTH = 1040;
const EDITOR_MIN_HEIGHT = 720;

/**
 * Create the main window. `showOnReady` defaults to true; pass false when
 * recreating it solely to run the capture flow (the renderer reveals it after a
 * successful shot), so the app doesn't flash to the front and into the capture.
 */
function createWindow(showOnReady = true): void {
  // A fresh window's renderer hasn't registered its IPC listeners yet; block
  // sends until it signals `appReady`.
  rendererReady = false;
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

  mainWindow.on("ready-to-show", () => {
    if (showOnReady) mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closingWithRecording = false;
  });

  // Closing the window mid-recording (the red button, or Cmd+W where the app
  // stays alive in the tray) would otherwise orphan the recording: the bar
  // sticks around with a frozen timer, the Dock policy is never restored, and
  // the Capture Panel stays locked until app restart. Confirm, then run the
  // recorder's normal stop path (finalizing what's on disk so far) before
  // actually closing — with a timeout so the window is never stuck if the
  // renderer is unresponsive.
  mainWindow.on("close", (event) => {
    if (closingWithRecording || !hub?.isActive()) return;
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
    if (choice !== 1) return;
    closingWithRecording = true;
    mainWindow?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
    const finishClose = (): void => mainWindow?.close();
    const timeout = setTimeout(finishClose, 5000);
    ipcMain.once(IPC_CHANNELS.recordingStop, () => {
      clearTimeout(timeout);
      finishClose();
    });
  });

  // If the renderer crashes/OOMs mid-recording there is no `recordingStop` IPC
  // coming — without this the hub's activity would stay "active" forever (bar
  // stuck, Dock policy never restored, Capture Panel permanently locked).
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("main renderer process gone", details.reason);
    hub?.forceReset();
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
function triggerStartRecording(): void {
  if (hub?.isActive()) {
    // Don't un-hide the (deliberately hidden) main window into an active
    // recording — it would get burned into the video with no explanation.
    // Let the user know the shortcut landed instead of silently no-oping.
    capturePanel?.hide();
    if (Notification.isSupported()) {
      const t = createMainTranslator(getAppSettings().locale);
      new Notification({
        title: t("dialogs.alreadyRecordingTitle"),
        body: t("dialogs.alreadyRecordingBody"),
      }).show();
    }
    return;
  }
  capturePanel?.hide();
  showMainWindow();
  sendToRenderer(IPC_CHANNELS.recordingRequestStart);
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
 * (see `captureWindowHooks`). The window comes back via `revealAfterCapture`.
 */
function triggerCaptureScreenshot(): void {
  // The capture flow runs in the renderer, so the window must exist. If it was
  // closed (macOS keeps the app alive in the tray), recreate it HIDDEN — never
  // show a hidden one: the capture handler hides the window anyway, and bringing
  // it forward here would put the app back in the shot. The renderer reveals it
  // after a successful capture.
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
  sendToRenderer(IPC_CHANNELS.screenshotHotkey);
}

/** Remembers whether the app was visible before a capture, to restore on cancel. */
let captureWasVisible = false;

/** Window orchestration handed to the screenshot IPC (hide for the shot, reveal after). */
const captureWindowHooks = {
  beforeCapture: (): void => {
    captureWasVisible = mainWindow?.isVisible() ?? false;
    capturePanel?.hide();
    mainWindow?.hide();
    // The bubble is always-on-top and not content-protected (it's meant to be
    // captured by a *recording*), so it would otherwise sit inside the native
    // region-select and land in the screenshot too.
    hub?.hideCameraBubbleForCapture();
  },
  afterCapture: (captured: boolean): void => {
    // On success the renderer reveals the window once it shows the editor; here we
    // only need to undo the hide when the user cancelled with the app previously up.
    if (!captured && captureWasVisible) showMainWindow();
    hub?.restoreCameraBubbleAfterCapture();
  },
  reveal: (): void => bringAppToFront(),
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.niway.kaipu-record");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
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
    for (const channel of queued) mainWindow?.webContents.send(channel);
  });

  // Persisted app settings (+ apply the Dock/switcher policy and launch-at-login).
  registerSettings();
  // Checked explicitly rather than asserted non-null: an unset value would otherwise reach
  // auth-client as `undefined` in the request URL and surface much later as a generic "network"
  // error the user cannot act on. Fail loudly at startup, naming the variable.
  const authServerUrl = import.meta.env.MAIN_VITE_SERVER_URL;
  if (!authServerUrl) throw new Error("MAIN_VITE_SERVER_URL is not set — check .env");
  const auth = registerAuth({ serverUrl: authServerUrl }, () => mainWindow);
  initMainAnalytics(getDeviceId());
  registerAnalyticsIpc();

  // Capture Panel → show the main window (the panel's "Open ↗" button).
  ipcMain.on("capture-panel:open-main", () => {
    capturePanel?.hide();
    showMainWindow();
  });

  // Capture Panel "Start" → open the main window and tell its Record page to start.
  ipcMain.on(IPC_CHANNELS.recordingRequestStart, triggerStartRecording);

  // Capture Panel "Change" → open the main window and open its source picker.
  ipcMain.on(IPC_CHANNELS.recordingRequestSourcePicker, triggerChooseSource);

  // Capture Panel "Capture Screen" → dismiss the panel and run the same interactive
  // region capture as the ⌘⌃X hotkey.
  ipcMain.on(IPC_CHANNELS.screenshotRequestCapture, () => {
    capturePanel?.hide();
    triggerCaptureScreenshot();
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
  hub = registerRecordingHub(() => mainWindow);

  // Global (system-wide) shortcuts. Reuse the existing start/stop paths so the
  // recorder logic stays in one place. Re-register when the bindings change.
  registerGlobalShortcuts({
    getShortcuts: () => getAppSettings().shortcuts,
    handlers: {
      startRecording: triggerStartRecording,
      stopRecording: () => mainWindow?.webContents.send(IPC_CHANNELS.recordingCommand, "stop"),
      bringToFront: bringAppToFront,
      captureScreenshot: triggerCaptureScreenshot,
    },
  });
  onSettingsChanged(() => applyGlobalShortcuts());
  // Rebuild the native tray menu when the language changes.
  onSettingsChanged((settings) => rebuildTrayMenu(settings.locale));

  // Library: local recordings vault + cloud catalog.
  registerLibraryVaultHandlers({ auth, serverUrl: authServerUrl });

  // Screenshots: capture/copy/save IPC handlers.
  registerScreenshotHandlers(captureWindowHooks);

  // Editor mode: give the screenshot editor more room, restore the floor on exit.
  ipcMain.on(IPC_CHANNELS.windowSetEditorMode, (_event, active: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (active) {
      mainWindow.setMinimumSize(EDITOR_MIN_WIDTH, EDITOR_MIN_HEIGHT);
      const [w, h] = mainWindow.getSize();
      if (w < EDITOR_MIN_WIDTH || h < EDITOR_MIN_HEIGHT) {
        mainWindow.setSize(Math.max(w, EDITOR_MIN_WIDTH), Math.max(h, EDITOR_MIN_HEIGHT), true);
      }
    } else {
      mainWindow.setMinimumSize(BASE_MIN_WIDTH, BASE_MIN_HEIGHT);
    }
  });

  // Auto-update (packaged builds only). Silent download; renderer shows a restart banner.
  initAutoUpdater(() => mainWindow);
  ipcMain.handle(IPC_CHANNELS.updateGetStatus, () => getUpdateStatus());
  ipcMain.on(IPC_CHANNELS.updateInstall, () => installDownloadedUpdate());

  // macOS media permissions (onboarding + settings).
  registerPermissionHandlers();

  // Stream local vault files to the renderer for playback (kaipu-media://).
  registerMediaProtocol();

  createWindow();

  // Menu-bar tray + its Capture Panel.
  capturePanel = new CapturePanelWindow();
  tray = createTray(capturePanel, showMainWindow, getAppSettings().locale);

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
    const finishQuit = (): void => app.quit();
    const timeout = setTimeout(finishQuit, 5000);
    ipcMain.once(IPC_CHANNELS.recordingStop, () => {
      clearTimeout(timeout);
      finishQuit();
    });
    return;
  }

  // The app lives in the menu bar — keep the tray reference alive and release it
  // only on quit so the icon isn't garbage-collected. Flush analytics best-effort
  // (fire-and-forget: client already flushes on every capture so nothing is lost).
  unregisterGlobalShortcuts();
  tray?.destroy();
  tray = null;
  void shutdownMainAnalytics();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
