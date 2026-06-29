import { app, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { IPC_CHANNELS, type UpdateStatus } from "@shared/types";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h while running

let status: UpdateStatus = { state: "idle" };

/** The last known status, for renderers that mount after `update-downloaded`. */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Quit and install a downloaded update (called from the renderer "Reiniciar" button). */
export function installDownloadedUpdate(): void {
  if (status.state === "ready") autoUpdater.quitAndInstall();
}

/**
 * Wire electron-updater. No-op in dev (electron-updater needs a packaged
 * app-update.yml). Silent background download; the renderer shows a "restart"
 * banner once `update-downloaded` fires. Fail-safe: errors are logged, never thrown.
 */
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    status = { state: "ready", version: info.version };
    getMainWindow()?.webContents.send(IPC_CHANNELS.updateStatus, status);
  });
  autoUpdater.on("error", (err) => {
    console.error("[auto-updater] error", err);
  });

  void autoUpdater.checkForUpdates().catch((err) => console.error("[auto-updater] check failed", err));
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((err) => console.error("[auto-updater] check failed", err));
  }, CHECK_INTERVAL_MS);
}
