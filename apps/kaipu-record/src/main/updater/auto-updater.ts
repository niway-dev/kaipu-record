import { BrowserWindow, app } from "electron";
import electronUpdater from "electron-updater";
import { IPC_CHANNELS, type UpdateStatus } from "@shared/types";
import {
  canStartCheck,
  nextUpdateStatus,
  shouldCheckOnFocus,
  type UpdaterEvent,
} from "@shared/updater-state";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h while running

let status: UpdateStatus = { state: "idle" };
let lastCheckStartedAt: number | null = null;

/** The last known status, for renderers that mount after an event fired. */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Quit and install a downloaded update (the renderer's "Restart" button). */
export function installDownloadedUpdate(): void {
  if (status.state === "ready") autoUpdater.quitAndInstall();
}

/**
 * Push the status to EVERY window, not just the main one. The settings view, the
 * control bar and the main window each hold their own copy; sending to one leaves the
 * others showing a status that is quietly out of date.
 */
function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.updateStatus, status);
  }
}

/** Fold an event through the pure reducer and push the result if it changed. */
function apply(event: UpdaterEvent): void {
  const next = nextUpdateStatus(status, event);
  if (next === status) return;
  status = next;
  broadcast();
}

/** The version a download belongs to. Only `available`/`downloading` carry one. */
function inFlightVersion(): string | null {
  if (status.state === "available" || status.state === "downloading") return status.version;
  return null;
}

function startCheck(): void {
  lastCheckStartedAt = Date.now();
  apply({ type: "check-started" });
  void autoUpdater.checkForUpdates().catch((err: unknown) => {
    // `checkForUpdates` rejects on network failures; the `error` event does not
    // always fire for them, so the rejection is folded in here too.
    apply({ type: "error", message: errorMessage(err), at: Date.now() });
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Run a check now on the renderer's behalf and resolve with the resulting status.
 *
 * Returns the CURRENT status untouched when a check is refused — a check already in
 * flight, a download running, or a build already waiting to install. The button is the
 * first thing that makes a concurrent call reachable, and electron-updater is not
 * re-entrant during a download.
 */
export function checkForUpdatesNow(): UpdateStatus {
  if (!app.isPackaged) return status;
  if (!canStartCheck(status)) return status;
  startCheck();
  return status;
}

/**
 * Wire electron-updater. No-op in dev (electron-updater needs a packaged
 * app-update.yml). Silent background download; the renderer shows a "restart" banner
 * once the download completes. Fail-safe: errors become an `error` status, never a throw.
 *
 * Three triggers, in the order they actually fire for a menu-bar app that stays open
 * for days: the manual button, a focus regained after the throttle window, and the
 * six-hour timer as the fallback.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => apply({ type: "check-started" }));
  autoUpdater.on("update-available", (info) =>
    apply({ type: "available", version: info.version, at: Date.now() }),
  );
  autoUpdater.on("update-not-available", () => apply({ type: "not-available", at: Date.now() }));
  autoUpdater.on("download-progress", (progress) => {
    const version = inFlightVersion();
    if (!version) return;
    apply({ type: "progress", version, percent: progress.percent });
  });
  autoUpdater.on("update-downloaded", (info) =>
    apply({ type: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", (err) => {
    console.error("[auto-updater] error", err);
    apply({ type: "error", message: errorMessage(err), at: Date.now() });
  });

  startCheck();
  setInterval(startCheck, CHECK_INTERVAL_MS);

  app.on("browser-window-focus", () => {
    if (!shouldCheckOnFocus(lastCheckStartedAt, Date.now())) return;
    if (!canStartCheck(status)) return;
    startCheck();
  });
}
