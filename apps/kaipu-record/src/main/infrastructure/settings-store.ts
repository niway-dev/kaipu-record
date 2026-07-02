import { app, ipcMain } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IPC_CHANNELS } from "@shared/types";
import type { AppSettings } from "@shared/types";
import { mergeSettings } from "../services/settings.service";

/**
 * Persisted app settings + their OS side effects. The pure merge/validate logic
 * lives in `services/settings.service.ts`; this is the infrastructure (disk, IPC,
 * Electron side effects) per that file's note.
 */

let settings: AppSettings = mergeSettings(null);

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function load(): void {
  try {
    settings = mergeSettings(
      JSON.parse(readFileSync(settingsPath(), "utf-8")) as Partial<AppSettings>,
    );
  } catch {
    settings = mergeSettings(null);
  }
  if (!settings.deviceId) {
    settings = { ...settings, deviceId: randomUUID() };
    persist();
  }
}

function persist(): void {
  try {
    // Atomic write: a crash/power-loss mid-write to the real file would leave a
    // truncated settings.json that fails JSON.parse on next launch — silently
    // resetting theme/dock/quality/shortcuts AND minting a new analytics
    // deviceId. Writing to a temp file then renaming over the original is atomic
    // on the same volume, so the real file is always complete-or-untouched.
    const path = settingsPath();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2));
    renameSync(tmp, path);
  } catch (error) {
    console.error("failed to persist settings", error);
  }
}

/** Stable per-install analytics id, minted on first load. */
export function getDeviceId(): string {
  return settings.deviceId;
}

/** Current persisted settings (read-only snapshot for other main modules). */
export function getAppSettings(): AppSettings {
  return settings;
}

/**
 * macOS Dock + Cmd+Tab visibility from the current settings. Exported so the
 * recording hub can re-assert it after hiding/showing the main window (hide/show
 * cycles, and showing a floating panel, can otherwise drop the app from the
 * switcher).
 */
export function applyDockPolicy(): void {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy(settings.showInDock ? "regular" : "accessory");
  if (settings.showInDock) app.dock?.show();
}

/**
 * Force `regular` activation (Dock + Cmd+Tab) regardless of the user's
 * preference. Used while recording: the main window is hidden, so without this
 * the app could vanish from the switcher with only the floating panels visible.
 * Pair with `applyDockPolicy()` to restore the preference afterwards.
 */
export function forceRegularPolicy(): void {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("regular");
  app.dock?.show();
}

// Listeners notified after every persisted settings change (e.g. to re-register
// global shortcuts when their bindings change).
const settingsListeners = new Set<(settings: AppSettings) => void>();

/** Subscribe to persisted settings changes. */
export function onSettingsChanged(listener: (settings: AppSettings) => void): void {
  settingsListeners.add(listener);
}

function applySideEffects(): void {
  applyDockPolicy();
  if (process.platform === "darwin" || process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }
}

/**
 * Loads persisted settings, registers the get/update IPC, and applies side
 * effects (Dock policy, launch-at-login). Call once after `app.whenReady`.
 */
export function registerSettings(): void {
  load();
  applySideEffects();

  ipcMain.handle(IPC_CHANNELS.getSettings, (): AppSettings => settings);
  ipcMain.handle(IPC_CHANNELS.updateSettings, (_e, patch: Partial<AppSettings>): AppSettings => {
    settings = mergeSettings({ ...settings, ...patch });
    persist();
    applySideEffects();
    for (const listener of settingsListeners) listener(settings);
    return settings;
  });
}
