/**
 * Shared IPC contract between the main and renderer processes.
 *
 * This file is PURE: it must not import from `electron`, `node:*`, or any
 * renderer-only API (the `recording-quality` import is itself pure). Both
 * processes import these types so the contract is verified by TypeScript at
 * compile time (this is what replaces runtime tests for the preload bridge).
 */

import { DEFAULT_QUALITY, type RecordingQuality } from "../recording-quality";

export type Theme = "light" | "dark" | "system";

/** Actions that can be bound to a global keyboard shortcut. */
export const SHORTCUT_ACTIONS = ["startRecording", "stopRecording", "bringToFront"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** Electron accelerator string per action (e.g. "Command+Control+C"). */
export type ShortcutSettings = Record<ShortcutAction, string>;

/**
 * Default global shortcuts. The `Command+Control` base is distinctive: it avoids
 * macOS reserved combos (screenshots, VoiceOver's Control+Option) and the
 * crowded Command+Shift space that browsers/editors lean on — important because
 * a global shortcut overrides the focused (recorded) app.
 */
export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  startRecording: "Command+Control+C", // Capture
  stopRecording: "Command+Control+S", // Stop
  bringToFront: "Command+Control+O", // Open
};

export interface AppSettings {
  theme: Theme;
  launchAtLogin: boolean;
  /**
   * macOS: show the app in the Dock + Cmd+Tab switcher (`regular` activation
   * policy). Off = menu-bar/tray-only (`accessory`) — no Dock, no switcher.
   */
  showInDock: boolean;
  /** Resolution/fps/bitrate the encoder targets (a preset or a custom combo). */
  recordingQuality: RecordingQuality;
  /**
   * Include the floating control bar in the captured video. Off (default) keeps
   * it out via content protection (`NSWindowSharingNone`).
   */
  showBarInRecording: boolean;
  /** User-rebindable global keyboard shortcuts (Electron accelerator strings). */
  shortcuts: ShortcutSettings;
  /**
   * Stable per-install id for analytics identity. Empty until the settings-store
   * mints one on first load; never shown in the UI.
   */
  deviceId: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  shortcuts: DEFAULT_SHORTCUTS,
  deviceId: "",
};

/**
 * Names of the IPC channels exposed by the preload bridge.
 * Using a const map keeps main and renderer in sync.
 */
export const IPC_CHANNELS = {
  getAppVersion: "app:get-version",
  updateGetStatus: "update:get-status",
  updateStatus: "update:status",
  updateInstall: "update:install",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  checkPermissions: "permissions:check",
  requestPermission: "permissions:request",
  openSystemSettings: "permissions:open-settings",
  listLocalRecordings: "library:list-local",
  renameLocalRecording: "library:rename-local",
  deleteLocalRecording: "library:delete-local",
  revealLocalRecording: "library:reveal-local",
  getVaultDirectory: "library:get-vault-dir",
  chooseVaultDirectory: "library:choose-vault-dir",
  resetVaultDirectory: "library:reset-vault-dir",
  // Recording engine (renderer ↔ main)
  recordingCreate: "recording:create",
  recordingWrite: "recording:write",
  recordingFinalize: "recording:finalize",
  recordingAbort: "recording:abort",
  recordingReportTick: "recording:report-tick",
  recordingStart: "recording:start",
  recordingStop: "recording:stop",
  // Control bar (main → bar broadcasts, bar → main commands)
  controlTick: "control:tick",
  controlCommand: "control:command",
  recordingCommand: "recording:command",
  // Global recording activity, broadcast to every window so non-recorder windows
  // (Record page when reopened, Capture Panel) reflect an in-progress recording.
  recordingState: "recording:state",
  recordingGetState: "recording:get-state",
  // Shared recording settings (source/toggles/mic) — single source of truth in main,
  // so the Record page and Capture Panel stay in sync. The hub also drives the camera
  // bubble from `isCameraEnabled`.
  recordingSettingsGet: "recording-settings:get",
  recordingSettingsUpdate: "recording-settings:update",
  recordingSettingsChanged: "recording-settings:changed",
  // Capture Panel asks the main window to start recording (panel → main → Record page).
  recordingRequestStart: "recording:request-start",
  // Per-action registration state of the global shortcuts (false = another app owns it).
  shortcutsGetStatus: "shortcuts:get-status",
  // Suspend/resume the global shortcuts while the user is capturing a new binding,
  // so the combo reaches the renderer instead of firing the (still-registered) action.
  shortcutsSuspend: "shortcuts:suspend",
  shortcutsResume: "shortcuts:resume",
  // Analytics: secondary windows forward serialized exceptions to the main-process sink.
  analyticsCaptureException: "analytics:capture-exception",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** `saving` covers the brief finalize/encode-flush window after Stop. */
export type RecordingStatus = "recording" | "paused" | "saving";

/** Auto-update state surfaced to the renderer. `ready` = a build is downloaded and installable. */
export type UpdateStatus = { state: "idle" } | { state: "ready"; version: string };

export interface RecordingTick {
  elapsedSeconds: number;
  levels: number[];
  status: RecordingStatus;
}

export type ControlCommand = "pause" | "resume" | "stop";

/** Global recording activity shared across windows. `status`/`elapsedSeconds` matter when active. */
export interface RecordingActivity {
  active: boolean;
  status: RecordingStatus;
  elapsedSeconds: number;
}

export interface RecordingFinalizeMeta {
  title: string;
  durationSeconds: number;
  thumbnail?: ArrayBuffer | null;
}

/** Source identity for placing the bar on the recorded screen. */
export interface RecordingStartInfo {
  sourceId: string;
  sourceName: string;
}

/**
 * Recording settings shared across windows (main is the source of truth). Pure
 * shapes so this file stays import-free; structurally compatible with the
 * renderer's `SelectedSource` / `Microphone`.
 */
export interface RecordingSettings {
  selectedSource: { id: string; name: string; type: "screen" | "window" } | null;
  selectedMicrophone: { deviceId: string; label: string } | null;
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
}
