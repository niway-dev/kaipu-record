import type { TagColor } from "@kaipu/domain/constants";
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
import type { ExportPresetId, ExportQuality } from "./export-preset";
import { ENABLED_CAPTURE_MODES, type CaptureMode, type CaptureRect } from "./screenshot-capture";

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
  "captureScreen",
  "captureFrame",
  "captureWindow",
  "recordArea",
  "toggleMicrophone",
  "toggleSystemAudio",
  "toggleCamera",
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
  /** Electron accelerators used when the user hasn't rebound the action, per platform. */
  defaultAccelerator: { mac: string; win: string };
  group: ShortcutGroup;
  /** Title shown on the Shortcuts page (e.g. "Start recording"). */
  label: string;
  /** One-line explanation shown under the label. */
  description: string;
  /** Terse word for the compact status bar (e.g. "start"). */
  statusWord: string;
}

/**
 * The accelerators are LITERALS here, and deliberately, even though
 * `DEFAULT_ACCELERATORS.mac` and `.windows` in `@kaipu/domain/constants` hold
 * the same pairs and the marketing site reads them. macOS uses
 * `Command+Control`; Windows uses `Control+Alt` (`CommandOrControl` would
 * collapse to plain Ctrl there and bind Ctrl+C, copy, globally).
 *
 * This file is reachable from the PRELOAD bundle, which externalizes workspace
 * packages and then cannot load their TypeScript at runtime — importing one
 * here makes the preload script fail, `window.electronAPI` come back undefined,
 * and the app open to a black window. The same reason `locale` above is a
 * literal instead of importing from `@kaipu/i18n`.
 *
 * `shortcut-defaults.test.ts` asserts these match domain, so the two cannot
 * drift — the shape this repo already uses to pin DEFAULT_LOCALE.
 */
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    action: "startRecording",
    defaultAccelerator: { mac: "Command+Control+C", win: "Control+Alt+C" },
    group: "recording",
    label: "Start recording",
    description: "Begin a screen recording from anywhere",
    statusWord: "start",
  },
  {
    action: "stopRecording",
    defaultAccelerator: { mac: "Command+Control+S", win: "Control+Alt+S" },
    group: "recording",
    label: "Stop recording",
    description: "End the current recording from anywhere",
    statusWord: "stop",
  },
  {
    action: "bringToFront",
    defaultAccelerator: { mac: "Command+Control+O", win: "Control+Alt+O" },
    group: "app",
    label: "Bring Kaipu to front",
    description: "Show the app window if it slips behind or out of reach",
    statusWord: "show app",
  },
  {
    action: "captureScreenshot",
    defaultAccelerator: { mac: "Command+Control+X", win: "Control+Alt+X" },
    group: "app",
    label: "Capture screenshot",
    description: "Capture with your current mode",
    statusWord: "capture",
  },
  {
    action: "captureScreen",
    defaultAccelerator: { mac: "Command+Control+Shift+X", win: "Control+Alt+Shift+X" },
    group: "app",
    label: "Capture screen",
    description: "Capture one whole display",
    statusWord: "screen",
  },
  {
    action: "captureFrame",
    defaultAccelerator: { mac: "Command+Control+Shift+F", win: "Control+Alt+Shift+F" },
    group: "app",
    label: "Capture frame",
    description: "Capture what is inside a remembered frame",
    statusWord: "frame",
  },
  {
    action: "captureWindow",
    defaultAccelerator: { mac: "Command+Control+W", win: "Control+Alt+W" },
    group: "app",
    label: "Capture window",
    description: "Capture one window, not the screen around it",
    statusWord: "window",
  },
  // Opens the capture overlay to choose what to record (ADR 0030): Enter keeps the area as
  // the recording target, ⌘R / Ctrl+R records it at once.
  {
    action: "recordArea",
    defaultAccelerator: { mac: "Command+Control+Shift+R", win: "Control+Alt+Shift+R" },
    group: "recording",
    label: "Record an area",
    description: "Choose part of the screen to record",
    statusWord: "area",
  },
  // Live input toggles: they flip the recording setting with or without a take
  // (outside a take they change the pre-recording toggle, as clicking it does).
  {
    action: "toggleMicrophone",
    defaultAccelerator: { mac: "Command+Control+M", win: "Control+Alt+M" },
    group: "recording",
    label: "Mute / unmute microphone",
    description: "Turn your voice on or off, also mid-recording",
    statusWord: "mic",
  },
  {
    action: "toggleSystemAudio",
    defaultAccelerator: { mac: "Command+Control+A", win: "Control+Alt+A" },
    group: "recording",
    label: "System audio on / off",
    description: "Turn what the computer plays on or off, also mid-recording",
    statusWord: "audio",
  },
  {
    action: "toggleCamera",
    defaultAccelerator: { mac: "Command+Control+K", win: "Control+Alt+K" },
    group: "recording",
    label: "Show / hide camera",
    description: "Show or hide the camera bubble, also mid-recording",
    statusWord: "camera",
  },
];

/**
 * Whether `action` is reachable right now. `captureWindow` follows Window mode's flag: the
 * action stays in the constants (a stored user binding survives), it is just neither
 * registered nor listed while Window mode is off.
 */
export function isShortcutActionEnabled(
  action: ShortcutAction,
  enabledModes: readonly CaptureMode[] = ENABLED_CAPTURE_MODES,
): boolean {
  return action !== "captureWindow" || enabledModes.includes("window");
}

/** `SHORTCUT_DEFINITIONS` minus the actions that are switched off: what the UI lists. */
export function activeShortcutDefinitions(
  enabledModes: readonly CaptureMode[] = ENABLED_CAPTURE_MODES,
): readonly ShortcutDefinition[] {
  return SHORTCUT_DEFINITIONS.filter((def) => isShortcutActionEnabled(def.action, enabledModes));
}

/**
 * How this device treats the cloud. Mutually exclusive, per device, never per account:
 *   • local-only — files stay on this device; nothing uploads.
 *   • manual     — the user picks what to upload.
 *   • automatic  — new files upload when space allows (never existing ones, never links).
 * Creating an account does not change it. Consumers (upload queue) arrive with cloud plan 03.
 */
export const UPLOAD_MODES = ["local-only", "manual", "automatic"] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

/**
 * Whether a Capture also lands on the system clipboard, or only when the user clicks
 * Copy. (Copy on the overlay always copies; every screenshot is saved to the Library.)
 */
export const SCREENSHOT_COPY_MODES = ["auto", "manual"] as const;
export type ScreenshotCopyMode = (typeof SCREENSHOT_COPY_MODES)[number];

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
  /**
   * Burn a small "Made with Kaipu" mark into recordings. Off by default: the free
   * app carries no watermark (backlog/free-tier-no-watermark), this is an opt-in
   * signature for people who want to credit the tool.
   */
  showBrandBadge: boolean;
  /**
   * "auto" (default): the composited capture is put on the clipboard the moment its
   * editor opens, so ⌘V works without touching Copy. "manual": only the Copy button
   * writes to the clipboard. Applies to fresh captures only, never to a shot
   * re-opened from the Library (backlog/settings-screenshot-clipboard).
   */
  screenshotCopy: ScreenshotCopyMode;
  /** User-rebindable global keyboard shortcuts (Electron accelerator strings). */
  shortcuts: ShortcutSettings;
  /**
   * Stable per-install id for analytics identity. Empty until the settings-store
   * mints one on first load; never shown in the UI.
   */
  deviceId: string;
  /** Upload preference for this device. See {@link UploadMode}. */
  uploadMode: UploadMode;
  /**
   * NIW2-218: the row the export sheet preselects (Settings → Export quality). Picking
   * another row in the sheet applies to that export only; nothing is remembered.
   */
  exportQuality: ExportQuality;
  /**
   * NIW2-218 export redesign: right after a recording heavier than GitHub's 10 MB limit,
   * its page shows a "Recording saved" card offering a light copy (auto-hides in 8 s).
   * Settings → Export turns it off.
   */
  showRecordingSavedCard: boolean;
  /**
   * Frame capture mode: the last frame the user confirmed, per display id (`String(id)`),
   * in display-relative DIP. Re-clamped to the display's work area when the overlay
   * opens, so a frame remembered before a resolution change is moved, not dropped.
   */
  screenshotFrame: Record<string, CaptureRect>;
  /**
   * The same memory for the overlay opened to RECORD (the `recordArea` shortcut, or Record
   * pressed on the overlay): the last area the user confirmed, per display id. Kept apart
   * from `screenshotFrame` because a recording stage and a screenshot frame are rarely the
   * same rectangle, and sharing one would make each feature undo the other's last choice.
   */
  recordingArea: Record<string, CaptureRect>;
  /**
   * The one current screenshot mode, app-wide. The Screenshots page, the tray panel and the
   * generic `captureScreenshot` shortcut all capture with it; picking a mode on the page or
   * the tray, or pressing a mode-specific shortcut (`captureScreen`, `captureFrame`, `captureWindow`), makes
   * that mode current. A mode the platform cannot serve stays stored but captures as Frame.
   * A stored legacy `"area"` is migrated to `"frame"` by the settings merge.
   */
  screenshotMode: CaptureMode;
  /**
   * Windows: closing the main window hides it to the tray. The first time it does,
   * the app says so once with a native notification ("Kaipu is still running"); this
   * records that the notification was shown, so it shows once per install.
   */
  trayHintShown: boolean;
  /**
   * Send error reports and technical events to PostHog (Settings → App → Privacy).
   * On by default; off means nothing leaves the device from either process, at the
   * cost of the team not seeing the errors this install hits. The privacy policy
   * describes it, and SignPath's signing terms require the opt-out.
   */
  diagnosticsEnabled: boolean;
}

/**
 * Defaults for everything except shortcuts, whose defaults depend on the
 * platform: see `defaultShortcutsFor` in `shared/shortcut-defaults.ts`.
 */
export const DEFAULT_SETTINGS: Omit<AppSettings, "shortcuts"> = {
  theme: "dark",
  // Must match DEFAULT_LOCALE in @kaipu/i18n. Kept as a literal on purpose: this
  // module is shared with preload, and importing the i18n package here would pull
  // React and both message catalogs into that bundle. `settings.service.test.ts`
  // asserts the two stay in agreement.
  locale: "en",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  showBrandBadge: false,
  screenshotCopy: "auto",
  deviceId: "",
  uploadMode: "local-only",
  // Literal on purpose (preload bundle); equals DEFAULT_EXPORT_QUALITY in ./export-preset.
  exportQuality: "balanced",
  showRecordingSavedCard: true,
  screenshotFrame: {},
  recordingArea: {},
  screenshotMode: "frame",
  trayHintShown: false,
  diagnosticsEnabled: true,
};

/** Prefixes on the `recording:finalize` rejection message; the renderer picks the toast from them. */
export const FINALIZE_KEPT_MARKER = "[finalize:kept]";
export const FINALIZE_ELSEWHERE_MARKER = "[finalize:elsewhere]";

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
  windowSetOnboardingMode: "window:set-onboarding-mode",
  /** A screen declaring the window size and minimum it wants (see window-size.ts). */
  windowApplyPreset: "window:apply-preset",
  /** The capture panel's selected mode, mirrored by the menu-bar icon. */
  traySetMode: "tray:set-mode",
  updateGetStatus: "update:get-status",
  updateStatus: "update:status",
  updateInstall: "update:install",
  updateCheck: "update:check",
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
  // macOS Accessibility, for the click hook. Status never prompts; request does (PR 10).
  accessibilityStatus: "permissions:accessibility-status",
  accessibilityRequest: "permissions:accessibility-request",
  listLocalRecordings: "library:list-local",
  renameLocalRecording: "library:rename-local",
  // Editor home: stamp an item as opened in an editor (sidecar `editorOpenedAt`).
  markOpenedInEditor: "library:mark-opened-in-editor",
  /** Tags as entities (ADR 0020): the registry, and which tags an item carries. */
  listTags: "tags:list",
  createTag: "tags:create",
  renameTag: "tags:rename",
  recolorTag: "tags:recolor",
  deleteTag: "tags:delete",
  setItemTags: "tags:setItemTags",
  backfillLocalRecordingMeta: "library:backfill-meta",
  deleteLocalRecording: "library:delete-local",
  revealLocalRecording: "library:reveal-local",
  /** NIW2-217: save an exported animated GIF into the vault (atomic, validated). */
  gifSave: "library:gif-save",
  /** NIW2-217: native drag-out of a vault file (e.g. a GIF into Slack or GitHub). */
  startFileDrag: "library:start-file-drag",
  /** NIW2-218: renderer → main, whether a background export is running (close/quit guard). */
  exportActive: "export:active",
  /** NIW2-218: main → renderer, "cancel" the running export (the user confirmed quitting). */
  exportCommand: "export:command",
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
  // Editor: read a recording's cursor track sidecar (raw JSON or null).
  loadCursorTrack: "library:load-cursor-track",
  // Screenshots (renderer ↔ main)
  screenshotCapture: "screenshot:capture",
  // Which `CaptureMode`s this platform's provider can serve (invoke, answers `CaptureMode[]`).
  screenshotSupportedModes: "screenshot:supported-modes",
  screenshotCopy: "screenshot:copy",
  // Copy a saved screenshot to the clipboard by id (main reads the file — fetch on
  // the kaipu-media:// scheme doesn't return bytes in the renderer).
  screenshotCopyById: "screenshot:copy-by-id",
  // Read a saved screenshot's PNG bytes by id (for re-opening it in the editor).
  screenshotReadBytes: "screenshot:read-bytes",
  screenshotSave: "screenshot:save",
  // Read the image on the system clipboard as PNG (the Editor's New → Paste).
  clipboardReadImage: "clipboard:read-image",
  // The clipboard image's size without sending its bytes (the Editor home peek).
  clipboardPeekImage: "clipboard:peek-image",
  // Write an exported capture (PDF today) to a path the user picks in a save dialog.
  screenshotExportFile: "screenshot:export-file",
  // Renderer → main: capture done + navigated to the editor, bring the app back.
  screenshotReveal: "screenshot:reveal",
  // Main → renderer: global hotkey fired, run the region capture flow.
  screenshotHotkey: "screenshot:hotkey",
  // Capture overlay: one window per display (main/screenshots/capture-overlay-windows.ts).
  // Overlay → main: the user's pick (`OverlayAnswer`); the first valid one wins.
  screenshotOverlayAnswer: "screenshot:overlay-answer",
  // Overlay → main: the pointer is over this display (`{ displayId: number | null }`).
  screenshotOverlayHover: "screenshot:overlay-hover",
  // Main → every overlay: `OverlayState` (`{ mode, hoverDisplayId, frameDisplayId, windows }`).
  screenshotOverlayState: "screenshot:overlay-state",
  // Overlay → main: switch every overlay to this mode (`{ mode: CaptureMode }`); main
  // validates, rebroadcasts the state, and lists the windows the first time Window is entered.
  screenshotOverlayMode: "screenshot:overlay-mode",
  // Overlay → main (Frame): "move the frame to this display" (`{ displayId: number }`).
  screenshotOverlayFrameDisplay: "screenshot:overlay-frame-display",
  // Main → overlay (no payload): "reply after your next animation frame"; overlay → main
  // on the same channel (no payload). Capture waits for every reply or a 250 ms cap.
  screenshotOverlayHiddenAck: "screenshot:overlay-hidden-ack",
  // Capture toast (main/screenshots/capture-toast-window.ts), shown after a quiet capture.
  // Main → toast: `CaptureToastPayload` to render; sent again with `saved` after Save.
  screenshotToastShow: "screenshot:toast-show",
  // Toast → main: `{ action: "annotate" | "open-library" | "save" | "dismiss" }`.
  screenshotToastAction: "screenshot:toast-action",
  // Toast → main: `{ paused: boolean }`, the pointer entered (true) or left (false) the card.
  screenshotToastHover: "screenshot:toast-hover",
  // Toast → main (no payload): the toast's listener is up; main sends the current payload.
  screenshotToastReady: "screenshot:toast-ready",
  // Main → main window: `OpenSavedScreenshotRequest`, open a saved shot in the editor or Library.
  screenshotOpenSaved: "screenshot:open-saved",
  // Main → main window: `QuietCaptureHandOff`, a copy-only capture's bytes for the editor.
  screenshotOpenQuietCapture: "screenshot:open-quiet-capture",
  // Recording engine (renderer ↔ main)
  recordingCreate: "recording:create",
  recordingWrite: "recording:write",
  recordingFinalize: "recording:finalize",
  recordingAbort: "recording:abort",
  /** NIW2-218: byte size of an open writer session's temp file (Small-file size check). */
  recordingStat: "recording:stat",
  recordingReportTick: "recording:report-tick",
  recordingStart: "recording:start",
  recordingStop: "recording:stop",
  // Cursor track (recorder renderer → main). Keyed by the writer session id. See
  // plans/video-editor-v2/02: main samples the pointer; the renderer sends the clock
  // anchor and pause edges already converted to main-clock ms.
  cursorTrackStart: "cursor-track:start",
  cursorClockNow: "cursor-track:clock-now",
  cursorTrackAnchor: "cursor-track:anchor",
  cursorTrackPause: "cursor-track:pause",
  cursorTrackResume: "cursor-track:resume",
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
  // Browser sign-in: begin (opens the system browser), cancel, paste-code fallback, and the
  // main → renderer failure event for a deep link that did not complete.
  authBeginBrowserSignIn: "auth:begin-browser-sign-in",
  authCancelBrowserSignIn: "auth:cancel-browser-sign-in",
  authSubmitCode: "auth:submit-code",
  authBrowserSignInFailed: "auth:browser-sign-in-failed",
  authSignOut: "auth:sign-out",
  authStatusChanged: "auth:status-changed",
  authResendVerification: "auth:resend-verification",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** `saving` covers the brief finalize/encode-flush window after Stop. */
export type RecordingStatus = "recording" | "paused" | "saving";

/**
 * Auto-update state surfaced to the renderer. `ready` = a build is downloaded and
 * installable.
 *
 * `checkedAt` (epoch ms) rides only on the variants that follow a COMPLETED check.
 * `checking`, `downloading` and `ready` carry no timestamp, and the UI omits the
 * last-checked line for them rather than showing a stale one. Keeping it off those
 * three is what makes this a widening of the old `idle | ready` union instead of a
 * rename: every existing consumer narrows on `state` and still compiles.
 */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | { state: "available"; version: string; checkedAt: number }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string; checkedAt: number };

export interface RecordingTick {
  elapsedSeconds: number;
  levels: number[];
  status: RecordingStatus;
  /**
   * Whether this take has a loopback (system audio) track. Omitted = unknown,
   * treated as available. Lets every window disable the system-audio toggle
   * mid-take when turning it on could not work.
   */
  systemAudioAvailable?: boolean;
}

export type ControlCommand = "pause" | "resume" | "stop";

/** A live tag and how many items carry it (ADR 0020). */
export interface TagSummary {
  id: string;
  name: string;
  slug: string;
  color: TagColor;
  count: number;
}

/** Global recording activity shared across windows. `status`/`elapsedSeconds` matter when active. */
export interface RecordingActivity {
  active: boolean;
  status: RecordingStatus;
  elapsedSeconds: number;
  /** See {@link RecordingTick.systemAudioAvailable}. Only meaningful while active. */
  systemAudioAvailable?: boolean;
}

/** What the GIF export sends with the file bytes (`gifSave`). No path: main picks it. */
export interface GifSaveMeta {
  title: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  /** JPEG of the first frame, or null when the worker could not encode one. */
  thumbnail: ArrayBuffer | null;
  derivedFromAssetId: string | null;
}

export interface RecordingFinalizeMeta {
  title: string;
  durationSeconds: number;
  /**
   * Unfloored `durationSeconds` in ms — the cursor tracker's `maxMs` cut needs the
   * real elapsed time, not the metadata's floored seconds (flooring can drop up to
   * ~1 s of real samples/clicks at the end of every recording).
   */
  durationMs: number;
  thumbnail?: ArrayBuffer | null;
  /** Set by the video editor's export: the asset the render was produced from. */
  derivedFromAssetId?: string | null;
  /** NIW2-218: the export preset that produced this file (sidecar `exportPreset`). */
  exportPreset?: ExportPresetId;
  /**
   * NIW2-218: what was encoded, so the same export can be reused instead of encoded again
   * (sidecar `exportFingerprint`): `"whole"` = the source file as it is on disk (Share),
   * `"edit:<hash>"` = the editor's scene at export time.
   */
  exportFingerprint?: string;
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
  /** Set when only part of the source's display is recorded (ADR 0030). */
  area?: RecordingArea | null;
}

/**
 * Part of one display to record (ADR 0030). The source is still that display's whole
 * `screen:` capture; the engine crops `rect` out of it on the compositor canvas.
 * `displaySize` travels with it because the renderer that encodes has no `screen` module
 * and the crop's scale is the captured track's size over this DIP size.
 */
export interface RecordingArea {
  displayId: number;
  /** Display-relative DIP. */
  rect: CaptureRect;
  /** The display's size in DIP (`Display.bounds`), when the area was chosen. */
  displaySize: { width: number; height: number };
}

/**
 * Recording settings shared across windows (main is the source of truth). Pure
 * shapes so this file stays import-free; structurally compatible with the
 * renderer's `SelectedSource` / `Microphone`.
 */
export interface RecordingSettings {
  selectedSource: {
    id: string;
    name: string;
    type: "screen" | "window";
  } | null;
  selectedMicrophone: { deviceId: string; label: string } | null;
  isMicrophoneEnabled: boolean;
  isSystemAudioEnabled: boolean;
  isCameraEnabled: boolean;
  /**
   * Record only this part of `selectedSource`'s display; `null` records the whole source.
   * Set together with `selectedSource` (that display's screen source) when an area is
   * chosen on the overlay; picking a source in the thumbnail picker clears it.
   */
  area: RecordingArea | null;
}
