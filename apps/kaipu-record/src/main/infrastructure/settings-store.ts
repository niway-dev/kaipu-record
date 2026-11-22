import { app, BrowserWindow, ipcMain } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IPC_CHANNELS } from "@shared/types";
import type { AppSettings } from "@shared/types";
import type { SettingsOverrides } from "@shared/settings-scope";
import {
  SHORTCUTS_VERSION,
  mergeSettings,
  migrateLegacyShortcuts,
} from "../services/settings.service";
import { resolveEffective } from "../workspaces/settings-overrides";

/**
 * Persisted app settings + their OS side effects. The pure merge/validate logic
 * lives in `services/settings.service.ts`; this is the infrastructure (disk, IPC,
 * Electron side effects) per that file's note.
 */

/**
 * The All workspaces level: what `userData/settings.json` holds, and the only thing ever
 * persisted. Never read it for a snapshot another module or window receives: those carry the
 * EFFECTIVE settings of the active workspace (ADR 0034, decision 5).
 */
let settings: AppSettings = mergeSettings(null);

/** The active workspace's overrides; `{}` until the workspaces module installs its source. */
let overridesSource: () => SettingsOverrides = () => ({});

/** The active workspace's effective settings: the overrides over the All level. */
let effective: AppSettings = settings;

function recomputeEffective(): void {
  effective = resolveEffective(settings, overridesSource());
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function load(): void {
  let parsed: Partial<AppSettings> | null = null;
  try {
    parsed = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Partial<AppSettings>;
  } catch {
    parsed = null;
  }
  // A file written before the shortcut trim: drop the removed actions and move a user still
  // on an old default to the new one. The version marker is persisted with the result, so it
  // runs once and a binding the user picks afterwards (even an old default) is kept.
  const fromVersion = (parsed as { shortcutsVersion?: unknown } | null)?.shortcutsVersion;
  const upgraded = migrateLegacyShortcuts(
    parsed?.shortcuts,
    typeof fromVersion === "number" ? fromVersion : 0,
  );
  if (parsed && upgraded.migrated) {
    parsed = { ...parsed, shortcuts: upgraded.shortcuts as AppSettings["shortcuts"] };
  }
  settings = mergeSettings(parsed);
  // An existing file below the current version is stamped even when nothing had to change;
  // a first run has no file and is stamped by the persist of its deviceId below.
  if (parsed && !(typeof fromVersion === "number" && fromVersion >= SHORTCUTS_VERSION)) persist();

  // The locale is NOT seeded from `app.getLocale()`: a first run opens in English
  // (`DEFAULT_LOCALE`) and the onboarding welcome step is where the user picks their
  // language. The owner chose one predictable first screen over OS detection.
  if (!settings.deviceId) {
    settings = { ...settings, deviceId: randomUUID() };
    persist();
  }
  recomputeEffective();
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
    writeFileSync(
      tmp,
      JSON.stringify({ ...settings, shortcutsVersion: SHORTCUTS_VERSION }, null, 2),
    );
    renameSync(tmp, path);
  } catch (error) {
    console.error("failed to persist settings", error);
  }
}

/** Stable per-install analytics id, minted on first load. */
export function getDeviceId(): string {
  return settings.deviceId;
}

/**
 * The effective settings of the active workspace (read-only snapshot for other main modules):
 * the workspace's override for each overridable key, otherwise the All workspaces value.
 */
export function getAppSettings(): AppSettings {
  return effective;
}

/** The persisted All workspaces level, for the scoped read and the Settings page's rows. */
export function getAllLevelSettings(): AppSettings {
  return settings;
}

/**
 * Where the active workspace's overrides come from (installed once by the workspaces module).
 * Call `notifyOverridesChanged()` whenever the answer may have changed.
 */
export function setOverridesSource(source: () => SettingsOverrides): void {
  overridesSource = source;
  recomputeEffective();
}

type ActivationPolicy = "regular" | "accessory";

/**
 * The activation policy this process last applied, or `null` before the first
 * call. Both policy setters go through `setActivationPolicy` and return early
 * when the policy is unchanged, because the transition itself is not free on
 * macOS: `app.dock.show()` on an active app briefly activates the Dock and
 * re-transforms the process into a foreground app, and AppKit orders every
 * window out and back in while it does. Seen by the user as "the main window
 * disappears when focus moves to the camera bubble" — the camera-on path
 * re-asserts the policy, and each re-assertion was a blur → hide → show cycle.
 * See backlog/bug-main-window-hides-on-blur.
 */
let appliedPolicy: ActivationPolicy | null = null;

/**
 * Whether the process is a regular (Dock + Cmd+Tab) app right now, as AppKit
 * sees it. Electron answers from NSRunningApplication's activation policy, so
 * this reflects transforms made outside this module — the `app.dock.hide()`
 * that `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })` runs
 * unless `skipTransformProcessType` is set. See ADR 0029.
 */
function isRegularNow(): boolean {
  return app.dock?.isVisible() ?? true;
}

function setActivationPolicy(policy: ActivationPolicy): void {
  if (process.platform !== "darwin") return;
  // "Unchanged" is decided against the real process state, not the cache alone.
  // The cache by itself turned a Dock drop made outside this module into a
  // permanent one: the app vanished from Cmd+Tab after the first recording and
  // every re-assertion (stop, the rescue shortcut) was a no-op. See
  // backlog/bug-app-lost-from-app-switcher. The probe keeps the no-churn
  // property: a re-assertion that matches reality still touches nothing.
  if (appliedPolicy === policy && (policy === "regular") === isRegularNow()) return;
  appliedPolicy = policy;
  app.setActivationPolicy(policy);
  if (policy === "regular") app.dock?.show();
}

/**
 * macOS Dock + Cmd+Tab visibility from the current settings. Exported so the
 * recording hub can re-assert it after hiding/showing the main window and after
 * its floating panels come and go. Idempotent: a call that changes nothing
 * touches no AppKit state; a call that finds the Dock dropped restores it.
 */
export function applyDockPolicy(): void {
  setActivationPolicy(settings.showInDock ? "regular" : "accessory");
}

/**
 * Force `regular` activation (Dock + Cmd+Tab) regardless of the user's
 * preference. Used while recording: the main window is hidden, so without this
 * the app could vanish from the switcher with only the floating panels visible.
 * Pair with `applyDockPolicy()` to restore the preference afterwards.
 */
export function forceRegularPolicy(): void {
  setActivationPolicy("regular");
}

/** Push the current settings to every window so renderer consumers stay in sync
 *  (query-on-mount + subscribe). Mirrors the recording-settings broadcast. */
function broadcastSettings(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.settingsChanged, effective);
  }
}

// Listeners notified after every settings change, with the EFFECTIVE settings of the active
// workspace (e.g. to re-register global shortcuts when their bindings change).
const settingsListeners = new Set<(settings: AppSettings) => void>();

/** Subscribe to settings changes (the argument is the active workspace's effective settings). */
export function onSettingsChanged(listener: (settings: AppSettings) => void): void {
  settingsListeners.add(listener);
}

/**
 * Subscribe to changes of some keys only: `listener` runs when one of `keys` differs (by
 * value) from what it last saw, and not for any other change. A recording start writes the
 * mode, and that must not re-register every global shortcut or rebuild the tray menu.
 */
export function onSettingsKeysChanged<K extends keyof AppSettings>(
  keys: readonly K[],
  listener: (settings: AppSettings) => void,
): void {
  const snapshot = (from: AppSettings): string => JSON.stringify(keys.map((key) => from[key]));
  let seen = snapshot(effective);
  settingsListeners.add((next) => {
    const now = snapshot(next);
    if (now === seen) return;
    seen = now;
    listener(next);
  });
}

/** The launch-at-login value last handed to the OS; `null` before the first. */
let appliedLaunchAtLogin: boolean | null = null;

function applySideEffects(): void {
  applyDockPolicy();
  // Only on a change: the OS call writes the login item each time, and every settings write
  // (a mode chip, a remembered frame) used to repeat it.
  if (
    (process.platform === "darwin" || process.platform === "win32") &&
    settings.launchAtLogin !== appliedLaunchAtLogin
  ) {
    appliedLaunchAtLogin = settings.launchAtLogin;
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }
}

/**
 * Merge `patch` into the persisted settings, then persist, apply side effects, notify
 * main listeners and broadcast to every window: the same path the renderer's
 * `updateSettings` takes, for main-side writers (a capture shortcut).
 */
export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  settings = mergeSettings({ ...settings, ...patch });
  persist();
  applySideEffects();
  recomputeEffective();
  for (const listener of settingsListeners) listener(effective);
  broadcastSettings();
  return effective;
}

/**
 * The active workspace's overrides changed (a switch, a capture start that found the folder
 * file edited, an override written or answered): recompute the effective settings, wake the
 * listeners of the keys that changed and broadcast the new snapshot to every window.
 */
export function notifyOverridesChanged(): void {
  const before = effective;
  recomputeEffective();
  if (JSON.stringify(before) === JSON.stringify(effective)) return;
  for (const listener of settingsListeners) listener(effective);
  broadcastSettings();
}

/**
 * Loads persisted settings, registers the get/update IPC, and applies side
 * effects (Dock policy, launch-at-login). Call once after `app.whenReady`.
 */
export function registerSettings(): void {
  load();
  applySideEffects();

  ipcMain.handle(IPC_CHANNELS.getSettings, (): AppSettings => effective);
  ipcMain.handle(IPC_CHANNELS.updateSettings, (_e, patch: Partial<AppSettings>): AppSettings => {
    // `adminMode` is written only through the admin-mode IPC, which accepts the main window
    // alone; a renderer's generic write (or a stale full snapshot) never changes it.
    const { adminMode: _adminMode, ...rest } = patch ?? {};
    return updateAppSettings(rest);
  });
}
