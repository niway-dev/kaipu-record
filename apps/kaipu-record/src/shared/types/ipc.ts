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
import type { RecordingCapture } from "../recording-capture";
import {
  ENABLED_CAPTURE_MODES,
  type CaptureMode,
  type CaptureRect,
  type RecordingRatio,
  type RememberedArea,
} from "./screenshot-capture";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "../audio-settings";
import { DEFAULT_CAMERA_BUBBLE, type CameraBubbleSettings } from "../camera-bubble";

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
  // the recording target, R records it at once.
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

/**
 * The countdown lengths Settings offers, in seconds. 0 starts the take right away.
 * Literals on purpose: this module is shared with the preload bundle.
 */
export const RECORDING_COUNTDOWN_OPTIONS = [0, 3, 5] as const;
export type RecordingCountdownSeconds = (typeof RECORDING_COUNTDOWN_OPTIONS)[number];
/** The countdown before a take when the setting was never changed: 3, 2, 1. */
export const DEFAULT_RECORDING_COUNTDOWN_SECONDS: RecordingCountdownSeconds = 3;

/** A stored or received value as one of the offered lengths; anything else is the default. */
export function sanitizeCountdownSeconds(value: unknown): RecordingCountdownSeconds {
  return (
    RECORDING_COUNTDOWN_OPTIONS.find((option) => option === value) ??
    DEFAULT_RECORDING_COUNTDOWN_SECONDS
  );
}

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
   * Seconds counted down before a take starts (Settings → Recording): 0 (off), 3 or 5. With 0
   * no number is shown and nothing waits: the take begins as soon as it is requested. Read at
   * the moment a start is requested, so a change applies to the next take.
   */
  recordingCountdownSeconds: RecordingCountdownSeconds;
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
  recordingArea: Record<string, RememberedArea>;
  /**
   * The mode "Start recording" opens the selector in (design "Kaipu Record Modes"): the
   * last one the user recorded with or picked on the Record page or the tray. `window`
   * opens the thumbnail picker while Window mode is off in the overlay (NIW2-469).
   */
  recordingMode: CaptureMode;
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
  /**
   * The camera bubble's shape, size and device (see `shared/camera-bubble.ts`). Changed
   * from the Camera settings popover (Record page), drawer (capture panel) or the
   * bubble's resize grip, and applied to a showing bubble live, mid-take included.
   */
  cameraBubble: CameraBubbleSettings;
  /**
   * The mic's level and noise reduction, the system audio's volume and its ducking (see
   * `shared/audio-settings.ts`). Changed from the Mic and System audio settings and applied
   * to a running take live. The mic device itself stays in `RecordingSettings`.
   */
  audio: AudioSettings;
  /**
   * The microphone picked last in the Mic settings, restored at launch into
   * `RecordingSettings.selectedMicrophone`, so a restart does not fall back to whichever
   * input the system lists first. `null` until one is picked.
   */
  microphone: { deviceId: string; label: string } | null;
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
  recordingCountdownSeconds: DEFAULT_RECORDING_COUNTDOWN_SECONDS,
  showBrandBadge: false,
  screenshotCopy: "auto",
  deviceId: "",
  uploadMode: "local-only",
  // Literal on purpose (preload bundle); equals DEFAULT_EXPORT_QUALITY in ./export-preset.
  exportQuality: "balanced",
  showRecordingSavedCard: true,
  screenshotFrame: {},
  recordingArea: {},
  recordingMode: "screen",
  screenshotMode: "frame",
  trayHintShown: false,
  diagnosticsEnabled: true,
  cameraBubble: DEFAULT_CAMERA_BUBBLE,
  audio: DEFAULT_AUDIO_SETTINGS,
  microphone: null,
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
  /** Camera access as a tri-state, so "blocked" is never confused with "not asked yet". */
  cameraAccessStatus: "permissions:camera-access-status",
  /** Bubble → main: resize the bubble while its grip is dragged (not persisted). */
  cameraBubblePreviewSize: "camera-bubble:preview-size",
  /** Bubble → main: a press on the bubble starts a move (remember the window's corner). */
  cameraBubbleMoveStart: "camera-bubble:move-start",
  /** Bubble → main: move the bubble by the pointer's offset since the press. */
  cameraBubbleMove: "camera-bubble:move",
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
  screenshotOverlayIntent: "screenshot:overlay-intent",
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
  // Mic levels for the settings meter, kept off the activity broadcast (10/s would re-render
  // every window). A window subscribes (renderer → main, counted); the recorder reports
  // levels (renderer → main) only while main says someone listens (main → recorder), and
  // main relays them to the subscribed windows alone (main → renderer).
  micLevelsSubscribe: "mic-levels:subscribe",
  micLevelsUnsubscribe: "mic-levels:unsubscribe",
  micLevelsReport: "mic-levels:report",
  micLevelsData: "mic-levels:data",
  micLevelsListening: "mic-levels:listening",
  micLevelsGetListening: "mic-levels:get-listening",
  recordingStart: "recording:start",
  // Main renderer → main (invoke), when a countdown ends, right before `recordingStart`: hide
  // the main window and answer whether it was on screen. A take acquired during the countdown
  // already captures the screen, and must not encode until the window has left it.
  recordingHideMainWindow: "recording:hide-main-window",
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
  // Record page / Capture Panel "Start recording" or a mode chip: main opens the selector
  // (the capture overlay with the record intent, or the thumbnail picker for Window).
  recordingRequestSelector: "recording:request-selector",
  // Main renderer → main: the recorder's phase while a start is pending, so main can draw
  // the countdown on the chosen region (recording shade window).
  recordingRecorderPhase: "recording:recorder-phase",
  // Main renderer → main (invoke): resolves once the countdown is on screen. A region
  // countdown is drawn by the shade window, which loads after the first tick is reported;
  // the recorder waits for it so "3" is not spent while that window is still loading.
  recordingCountdownVisible: "recording:countdown-visible",
  // Main renderer → main: a `[record-timing]` mark, logged on main's clock so a start or a
  // stop reads as one timeline in the terminal (see `main/recording/record-timing.ts`).
  recordingTiming: "recording:timing",
  // Main → recording shade window: countdown tick or recording.
  recordingShadeState: "recording-shade:state",
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

/**
 * What the control bar shows. `starting` is the bar's own: main resets the bar to it when a
 * take starts and when the bar is hidden, and a new bar window opens on it, so the bar never
 * shows a previous take's state while the next one acquires its streams. The recorder never
 * reports it, and the shared activity has no such status.
 */
export type ControlBarStatus = RecordingStatus | "starting";

export interface RecordingTick {
  elapsedSeconds: number;
  levels: number[];
  status: ControlBarStatus;
  /**
   * Whether this take has a loopback (system audio) track. Omitted = unknown,
   * treated as available. Lets every window disable the system-audio toggle
   * mid-take when turning it on could not work.
   */
  systemAudioAvailable?: boolean;
}

/** The bar between a take's start and its first tick: no timer, no level, Stop only. */
export const CONTROL_BAR_STARTING_TICK: RecordingTick = Object.freeze({
  elapsedSeconds: 0,
  levels: Object.freeze([0, 0, 0, 0, 0]) as number[],
  status: "starting",
});

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
  /**
   * A take is pending: its countdown runs or its streams are being acquired, so `active` is
   * still false. Windows treat it as busy (no second selector, no screenshot).
   */
  pending?: boolean;
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
   * Video time (ms since the MP4's first media sample, pauses removed) when Stop was
   * requested — not the bar's wall-clock timer, which starts later. The cursor
   * tracker's `maxMs` cut needs it unfloored and in the samples' time base
   * (flooring, or the wall clock's late start, drops real samples/clicks at the end).
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
  /**
   * How a new take was captured (mode, output size, ratio), stored in the sidecar for
   * library labels. Set by the recorder only; exports leave it unset. Main sanitizes it.
   */
  capture?: RecordingCapture | null;
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

/**
 * The recorder's phase as main needs it to draw the countdown over the chosen region
 * (main renderer → main). `counting` carries the tick (3, 2, 1, or from 5 down); `starting`
 * is the gap while streams are acquired (the first report when the countdown is off); `idle`
 * after a cancel or a failed start.
 */
export type RecorderPhaseReport =
  | { phase: "counting"; value: number }
  | { phase: "starting" }
  | { phase: "idle" };

/**
 * A `[record-timing]` mark from the main renderer: `begin` restarts main's clock (a stop),
 * `end` closes the timeline (the take is recording), `mark` is any step in between.
 */
export type RecordTimingKind = "begin" | "mark" | "end";

/** What the recording shade paints (main → shade window). */
export type RecordingShadeState =
  | { phase: "countdown"; value: number | null }
  | { phase: "recording" }
  // Neutral: nothing painted. The preloaded window waits in it, and a hidden one is reset to it.
  | { phase: "idle" };

/**
 * What main sends the shade window: the state plus the region it is drawn on (display-relative
 * DIP, `null` for the whole display). The window is reused across takes, so the region travels
 * as state, not in its URL. Absent `rect` keeps the last one.
 */
export type RecordingShadeView = RecordingShadeState & {
  rect?: CaptureRect | null;
};

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
  /**
   * The aspect ratio the remembered area is locked to, when the Record page set one.
   * Absent on areas chosen before ratios existed; the capture metadata then infers it.
   */
  ratio?: RecordingRatio;
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
