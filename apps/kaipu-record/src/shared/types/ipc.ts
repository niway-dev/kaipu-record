/**
 * Shared IPC contract between the main and renderer processes.
 *
 * This file is PURE: it must not import from `electron`, `node:*`, or any
 * renderer-only API (the `recording-quality` import is itself pure). Both
 * processes import these types so the contract is verified by TypeScript at
 * compile time (this is what replaces runtime tests for the preload bridge).
 */

import { DEFAULT_QUALITY, type RecordingQuality } from "../recording-quality";
import type { Locale } from "@kaipu/i18n";

/**
 * "system" (follow the OS appearance) is a deliberate non-goal for now — the
 * tokens ship dark (:root default) + light only. Legacy persisted "system"
 * values coerce to "dark" in mergeSettings.
 */
export type Theme = "light" | "dark";

/** Actions that can be bound to a global keyboard shortcut. */
export const SHORTCUT_ACTIONS = [
  "startRecording",
  "stopRecording",
  "bringToFront",
  "captureScreenshot",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** Electron accelerator string per action (e.g. "Command+Control+C"). */
export type ShortcutSettings = Record<ShortcutAction, string>;

/** Which on-screen group a shortcut belongs to (drives the Shortcuts page sections). */
export type ShortcutGroup = "recording" | "app";

/**
 * The single source of truth for every shortcut: its default accelerator plus all
 * the human-readable copy. The Shortcuts page, the status bar, and the default
 * settings all derive from this array — change a label or default here and every
 * surface updates. (Keep this in sync with the handlers wired in `main/index.ts`.)
 */
export interface ShortcutDefinition {
  action: ShortcutAction;
  /** Electron accelerator used when the user hasn't rebound the action. */
  defaultAccelerator: string;
  group: ShortcutGroup;
  /** Title shown on the Shortcuts page (e.g. "Start recording"). */
  label: string;
  /** One-line explanation shown under the label. */
  description: string;
  /** Terse word for the compact status bar (e.g. "start"). */
  statusWord: string;
}

/**
 * The `Command+Control` base is distinctive: it avoids macOS reserved combos
 * (screenshots, VoiceOver's Control+Option) and the crowded Command+Shift space
 * that browsers/editors lean on — important because a global shortcut overrides
 * the focused (recorded) app.
 */
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    action: "startRecording",
    defaultAccelerator: "Command+Control+C",
    group: "recording",
    label: "Start recording",
    description: "Begin a screen recording from anywhere",
    statusWord: "start",
  },
  {
    action: "stopRecording",
    defaultAccelerator: "Command+Control+S",
    group: "recording",
    label: "Stop recording",
    description: "End the current recording from anywhere",
    statusWord: "stop",
  },
  {
    action: "bringToFront",
    defaultAccelerator: "Command+Control+O",
    group: "app",
    label: "Bring Kaipu to front",
    description: "Show the app window if it slips behind or out of reach",
    statusWord: "show app",
  },
  {
    action: "captureScreenshot",
    defaultAccelerator: "Command+Control+X",
    group: "app",
    label: "Capture screenshot",
    description: "Open the area selection to take a screenshot",
    statusWord: "capture",
  },
];

/** Default accelerators, derived so they can never drift from the definitions. */
export const DEFAULT_SHORTCUTS: ShortcutSettings = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map((d) => [d.action, d.defaultAccelerator]),
) as ShortcutSettings;

/**
 * How this device treats the cloud. Mutually exclusive, per device, never per account:
 *   • local-only — files stay on this device; nothing uploads.
 *   • manual     — the user picks what to upload.
 *   • automatic  — new files upload when space allows (never existing ones, never links).
 * Creating an account does not change it. Consumers (upload queue) arrive with cloud plan 03.
 */
export const UPLOAD_MODES = ["local-only", "manual", "automatic"] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

export interface AppSettings {
  theme: Theme;
  /** UI language for every renderer window + the native tray. */
  locale: Locale;
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
  /** Upload preference for this device. See {@link UploadMode}. */
  uploadMode: UploadMode;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  shortcuts: DEFAULT_SHORTCUTS,
  deviceId: "",
  uploadMode: "local-only",
};

/**
 * Names of the IPC channels exposed by the preload bridge.
 * Using a const map keeps main and renderer in sync.
 */
export const IPC_CHANNELS = {
  getAppVersion: "app:get-version",
  // Renderer → main: the app shell has mounted and registered its IPC listeners.
  // Main defers window-triggered actions (start/capture/source-picker sent to a
  // freshly-created window) until this arrives, so they aren't dropped by racing
  // the listeners' registration against the page's did-finish-load.
  appReady: "app:ready",
  // Renderer → main: grow/reset the window for the screenshot editor.
  windowSetEditorMode: "window:set-editor-mode",
  updateGetStatus: "update:get-status",
  updateStatus: "update:status",
  updateInstall: "update:install",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  // Main → every window: persisted AppSettings changed. Lets cross-window
  // consumers (the control-bar's Stop-shortcut hint, useAppSettings) follow the
  // documented query-on-mount + subscribe pattern instead of a focus/remount
  // workaround the always-alive control-bar window never triggers.
  settingsChanged: "settings:changed",
  checkPermissions: "permissions:check",
  requestPermission: "permissions:request",
  openSystemSettings: "permissions:open-settings",
  listLocalRecordings: "library:list-local",
  renameLocalRecording: "library:rename-local",
  backfillLocalRecordingMeta: "library:backfill-meta",
  deleteLocalRecording: "library:delete-local",
  revealLocalRecording: "library:reveal-local",
  getVaultDirectory: "library:get-vault-dir",
  chooseVaultDirectory: "library:choose-vault-dir",
  resetVaultDirectory: "library:reset-vault-dir",
  // Open the recordings folder itself in the OS file manager.
  openVaultDirectory: "library:open-vault-dir",
  // The signed-in account's cloud capacity (used / reserved / available).
  getStorageUsage: "cloud:get-storage-usage",
  // Main → every window: the vault folder changed, so open pages should re-list.
  libraryChanged: "library:changed",
  // Combined library: local vault + the signed-in account's cloud catalog cache.
  listLibraryItems: "library:list-items",
  refreshCloudCatalog: "library:refresh-cloud-catalog",
  // Frees disk space for an item whose identical bytes are in cloud; never the generic delete.
  removeLocalCopy: "library:remove-local-copy",
  // Screenshots (renderer ↔ main)
  screenshotCapture: "screenshot:capture",
  screenshotCopy: "screenshot:copy",
  // Copy a saved screenshot to the clipboard by id (main reads the file — fetch on
  // the kaipu-media:// scheme doesn't return bytes in the renderer).
  screenshotCopyById: "screenshot:copy-by-id",
  // Read a saved screenshot's PNG bytes by id (for re-opening it in the editor).
  screenshotReadBytes: "screenshot:read-bytes",
  screenshotSave: "screenshot:save",
  // Renderer → main: capture done + navigated to the editor, bring the app back.
  screenshotReveal: "screenshot:reveal",
  // Main → renderer: global hotkey fired, run the region capture flow.
  screenshotHotkey: "screenshot:hotkey",
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
  // Capture Panel "Change" asks the main window to open the screen picker (panel → main
  // → Record page opens the source picker). Reused as the main → renderer broadcast too.
  recordingRequestSourcePicker: "recording:request-source-picker",
  // Capture Panel asks main to run the interactive screenshot capture (panel → main →
  // same flow as the ⌘⌃X hotkey). Send-only; the capture result flows through the
  // existing screenshot channels.
  screenshotRequestCapture: "screenshot:request-capture",
  // Per-action registration state of the global shortcuts (false = another app owns it).
  shortcutsGetStatus: "shortcuts:get-status",
  // Suspend/resume the global shortcuts while the user is capturing a new binding,
  // so the combo reaches the renderer instead of firing the (still-registered) action.
  shortcutsSuspend: "shortcuts:suspend",
  shortcutsResume: "shortcuts:resume",
  // Analytics: secondary windows forward serialized exceptions to the main-process sink.
  analyticsCaptureException: "analytics:capture-exception",
  // Video-editor session persistence. Save/load the edit session JSON + slide asset
  // bytes for a given recording id — called on export (save) and on editor mount
  // (load). Sessions live in `.kaipu/<id>.edit.json` beside existing metadata sidecars;
  // slide assets in `.kaipu/<id>.assets/<assetId>.png` so a recording delete can clean
  // them all up in one directory removal.
  videoEditSaveSession: "videoEdit:save-session",
  videoEditLoadSession: "videoEdit:load-session",
  // Authentication (main → renderer bridge; implemented in src/preload)
  authGetStatus: "auth:get-status",
  authSignIn: "auth:sign-in",
  authSignUp: "auth:sign-up",
  authSignOut: "auth:sign-out",
  authStatusChanged: "auth:status-changed",
  authResendVerification: "auth:resend-verification",
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
  /** Set by the video editor's export: the asset the render was produced from. */
  derivedFromAssetId?: string | null;
}

/**
 * Duration + poster the renderer decoded from a recording file that had no
 * sidecar, sent to main to persist. `thumbnail` is null when the frame couldn't
 * be decoded (duration-only heal).
 */
export interface RecordingBackfillMeta {
  durationSeconds: number;
  thumbnail: ArrayBuffer | null;
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
