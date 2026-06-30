import { app, shell, BrowserWindow, ipcMain, Tray } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types";
import icon from "../../resources/icon.png?asset";
import { CapturePanelWindow } from "./capture-panel-window";
import { createTray } from "./tray";
import { registerRecordingSourceHandlers } from "./recording-sources";
import { registerPermissionHandlers } from "./permissions";
import { registerLibraryVaultHandlers } from "./library";
import { registerMediaProtocol, registerMediaScheme } from "./media-protocol";
import { registerRecordingHub } from "./recording/recording-hub";
import { initAutoUpdater, getUpdateStatus, installDownloadedUpdate } from "./updater/auto-updater";
import {
  registerSettings,
  getDeviceId,
  getAppSettings,
  applyDockPolicy,
  onSettingsChanged,
} from "./infrastructure/settings-store";
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

// Must run before `app.whenReady` — privileged scheme registration.
registerMediaScheme();

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: "Kaipu Record",
    width: 900,
    height: 670,
    // Floor the size so neither the main UI nor the onboarding overlay can be
    // squeezed into a broken layout.
    minWidth: 720,
    minHeight: 560,
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
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
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
  capturePanel?.hide();
  showMainWindow();
  const contents = mainWindow?.webContents;
  if (!contents) return;
  if (contents.isLoading()) {
    contents.once("did-finish-load", () => contents.send(IPC_CHANNELS.recordingRequestStart));
  } else {
    contents.send(IPC_CHANNELS.recordingRequestStart);
  }
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
  const contents = mainWindow?.webContents;
  if (!contents) return;
  if (contents.isLoading()) {
    contents.once("did-finish-load", () => contents.send(IPC_CHANNELS.screenshotHotkey));
  } else {
    contents.send(IPC_CHANNELS.screenshotHotkey);
  }
}

/** Remembers whether the app was visible before a capture, to restore on cancel. */
let captureWasVisible = false;

/** Window orchestration handed to the screenshot IPC (hide for the shot, reveal after). */
const captureWindowHooks = {
  beforeCapture: (): void => {
    captureWasVisible = mainWindow?.isVisible() ?? false;
    capturePanel?.hide();
    mainWindow?.hide();
  },
  afterCapture: (captured: boolean): void => {
    // On success the renderer reveals the window once it shows the editor; here we
    // only need to undo the hide when the user cancelled with the app previously up.
    if (!captured && captureWasVisible) showMainWindow();
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

  // Persisted app settings (+ apply the Dock/switcher policy and launch-at-login).
  registerSettings();
  initMainAnalytics(getDeviceId());
  registerAnalyticsIpc();

  // Capture Panel → show the main window (the panel's "Open ↗" button).
  ipcMain.on("capture-panel:open-main", () => {
    capturePanel?.hide();
    showMainWindow();
  });

  // Capture Panel "Start" → open the main window and tell its Record page to start.
  ipcMain.on(IPC_CHANNELS.recordingRequestStart, triggerStartRecording);

  // App version for the renderer-side version gate.
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

  // Per-action registration state of the global shortcuts (for the Settings UI).
  ipcMain.handle(IPC_CHANNELS.shortcutsGetStatus, () => getShortcutStatus());
  // While the Settings UI captures a new binding, release the global shortcuts so
  // the combo reaches the renderer (and doesn't fire the action being rebound).
  ipcMain.on(IPC_CHANNELS.shortcutsSuspend, () => unregisterGlobalShortcuts());
  ipcMain.on(IPC_CHANNELS.shortcutsResume, () => applyGlobalShortcuts());

  // Recording: screen/window source enumeration.
  registerRecordingSourceHandlers();

  // Recording engine: disk writer, control-bar window, state relay.
  registerRecordingHub(() => mainWindow);

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

  // Library: local recordings vault.
  registerLibraryVaultHandlers();

  // Screenshots: capture/copy/save IPC handlers.
  registerScreenshotHandlers(captureWindowHooks);

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
  tray = createTray(capturePanel, showMainWindow);

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// The app lives in the menu bar — keep the tray reference alive and release it
// only on quit so the icon isn't garbage-collected. Flush analytics best-effort
// (fire-and-forget: client already flushes on every capture so nothing is lost).
app.on("before-quit", () => {
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
