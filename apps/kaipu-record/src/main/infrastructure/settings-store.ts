import { app, ipcMain } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
}

function persist(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("failed to persist settings", error);
  }
}

/**
 * macOS Dock + Cmd+Tab visibility from the current settings. Exported so the
 * recording hub can re-assert it after hiding/showing the main window (hide/show
 * cycles can otherwise drop the app from the switcher).
 */
export function applyDockPolicy(): void {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy(settings.showInDock ? "regular" : "accessory");
  if (settings.showInDock) app.dock?.show();
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
    return settings;
  });
}
