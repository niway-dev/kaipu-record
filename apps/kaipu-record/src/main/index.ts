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
import { registerSettings } from "./infrastructure/settings-store";

let mainWindow: BrowserWindow | null = null;
let capturePanel: CapturePanelWindow | null = null;
let tray: Tray | null = null;

// Must run before `app.whenReady` — privileged scheme registration.
registerMediaScheme();

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
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

  // Capture Panel → show the main window (the panel's "Open ↗" button).
  ipcMain.on("capture-panel:open-main", () => {
    capturePanel?.hide();
    showMainWindow();
  });

  // Capture Panel "Start" → open the main window and tell its Record page to
  // start (recording runs in the main renderer, not the transparent panel).
  ipcMain.on(IPC_CHANNELS.recordingRequestStart, () => {
    capturePanel?.hide();
    showMainWindow();
    const contents = mainWindow?.webContents;
    if (!contents) return;
    if (contents.isLoading()) {
      contents.once("did-finish-load", () => contents.send(IPC_CHANNELS.recordingRequestStart));
    } else {
      contents.send(IPC_CHANNELS.recordingRequestStart);
    }
  });

  // Recording: screen/window source enumeration.
  registerRecordingSourceHandlers();

  // Recording engine: disk writer, control-bar window, state relay.
  registerRecordingHub(() => mainWindow);

  // Library: local recordings vault.
  registerLibraryVaultHandlers();

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
// only on quit so the icon isn't garbage-collected.
app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
