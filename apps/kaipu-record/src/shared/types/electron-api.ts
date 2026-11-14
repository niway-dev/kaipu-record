import type { NativeCaptureBridge } from "../native-capture";
import type { WindowPresetName } from "../window-size";
/**
 * Contract for the renderer-facing `window.electronAPI` bridge (implemented in
 * `src/preload`, typed for the renderer via `src/preload/index.d.ts`). Pure types.
 */

import type {
  CaptureIntent,
  CaptureMode,
  CaptureRequestPayload,
  CaptureResult,
  CaptureToastAction,
  CaptureToastPayload,
  CaptureToastTimer,
  OpenSavedScreenshotRequest,
  OverlayAnswer,
  OverlayState,
  QuietCaptureHandOff,
} from "./screenshot-capture";
import type {
  RecordingReadyAction,
  RecordingReadyHandOff,
  RecordingReadyPayload,
  RecordingReadyTimer,
} from "./recording-ready";
import type { FlagName, SerializedError } from "../analytics";
import type { RecordingWriterKind } from "../webcam-track";
import type { AppSettings, ShortcutAction, TagSummary, UpdateStatus } from "./ipc";
import type { TagColor } from "@kaipu/domain/constants";
import type { LocalRecording, RenameResult } from "./library-storage";
import type { CanvasReadResult, CanvasSavePayload } from "./screenshot-canvas";
import type {
  TextCacheSavePayload,
  TextRecognitionRequest,
  TextRecognitionResult,
} from "./text-recognition";
import type {
  ReconcileFixResult,
  ReconcileProgress,
  ReconcileScanResult,
} from "./library-reconcile";
import type {
  LocationCheck,
  MoveItemsRequest,
  MoveItemsResult,
  MoveProgress,
  WorkspaceAddResult,
  WorkspaceCreateResult,
  WorkspaceEditRequest,
  WorkspaceEditResult,
  WorkspaceRelocateResult,
  WorkspaceRemoveResult,
  WorkspacesState,
  WorkspaceSwitchResult,
} from "./workspaces";
import type {
  CopyToAllResult,
  OverridableKey,
  ResetOverridesResult,
  ResolvePendingResult,
  ScopedSettings,
  SetOverrideResult,
  SettingsScope,
} from "../settings-scope";
import type { StorageUsageResult } from "./cloud-storage";
import type { ImportVideoResult } from "../import-video";
import type {
  CatalogRefreshResult,
  LibraryListResult,
  RemoveLocalCopyResult,
} from "./library-item";
import type {
  ControlCommand,
  RecordingActivity,
  GifSaveMeta,
  RecordingBackfillMeta,
  RecordingArea,
  RecordingFinalizeMeta,
  RecorderPhaseReport,
  RecordTimingKind,
  RecordingSettings,
  RecordingShadeView,
  RecordingStartInfo,
  RecordingTick,
} from "./ipc";
import type { AuthError, AuthStatus, BrowserSignInIntent } from "./auth";

/** A capture source returned by the screen picker — includes a base64 thumbnail. */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  type: "screen" | "window";
}

/**
 * The capture overlay window's bridge (`?window=capture-overlay`, one per display). The
 * overlay only answers what the user picked; main captures the pixels.
 */
export interface CaptureOverlayBridge {
  /** Send the user's pick. Main keeps the first valid answer and ignores the rest. */
  answer(answer: OverlayAnswer): void;
  /** The pointer entered this display (its id) or left it (`null`). */
  hover(displayId: number | null): void;
  /** Frame mode: ask main to move the one frame to this display. */
  chooseFrameDisplay(displayId: number): void;
  /** The mode pill or keys 1–3: ask main to switch every overlay to `mode`. */
  setMode(mode: CaptureMode): void;
  /** P / V or the Capture | Record switch: ask main to switch every overlay to `intent`. */
  setIntent(intent: CaptureIntent): void;
  /** Main's state broadcast (mode, hover, frame display, window list). Returns an unsubscribe fn. */
  onState(callback: (state: OverlayState) => void): () => void;
  /** Ask main for the current state again, once `onState` is listening (see `screenshotOverlayStateRequest`). */
  requestState(): void;
  /** Main hid the overlays and asks for an ack after the next frame. Returns an unsubscribe fn. */
  onHiddenAckRequest(callback: () => void): () => void;
  /** Answer `onHiddenAckRequest`: this overlay has painted its last frame. */
  hiddenAck(): void;
}

/**
 * The capture toast window's bridge (`?window=capture-toast`). The toast only renders what
 * main sends and reports what the user pressed; main runs every action.
 */
export interface CaptureToastBridge {
  /** Main's payload for the card (a new capture, or the same one after Save). Returns an unsubscribe fn. */
  onShow(callback: (payload: CaptureToastPayload) => void): () => void;
  /** Tell main the listener is up, so it sends the current payload. */
  ready(): void;
  /** A button or the ×. */
  action(action: CaptureToastAction): void;
  /** The pointer entered (`true`, pause the auto-hide) or left (`false`, restart it) the card. */
  hover(paused: boolean): void;
  /** Main's auto-hide timer, for the card's bar. Returns an unsubscribe fn. */
  onTimer(callback: (timer: CaptureToastTimer) => void): () => void;
}

/**
 * The "Your video is ready" window's bridge (`?window=recording-ready`). Like the capture
 * toast, the card only renders what main sends and reports what the user pressed.
 */
export interface RecordingReadyCardBridge {
  /** Main's payload for the card. Returns an unsubscribe fn. */
  onShow(callback: (payload: RecordingReadyPayload) => void): () => void;
  /** Tell main the listener is up, so it sends the current payload. */
  ready(): void;
  /** A chip, Edit first, Open, ✕ or Escape. */
  action(action: RecordingReadyAction): void;
  /** The card's height in DIP, so main sizes the window to it. */
  resize(height: number): void;
  /** The pointer entered (true) or left (false) the card: main holds or restarts the auto-hide. */
  hover(paused: boolean): void;
  /** Main's auto-hide, for the card's bar. Returns an unsubscribe fn. */
  onTimer(callback: (timer: RecordingReadyTimer) => void): () => void;
}

/** macOS media permissions the recorder cares about. */
export type PermissionKind = "screen" | "microphone" | "camera";

/** Whether each permission is currently granted. */
export type PermissionStatus = Record<PermissionKind, boolean>;

/**
 * Camera access as the OS reports it. "blocked" means denied or restricted: the OS
 * will not prompt again, so the UI sends the user to System Settings instead of
 * offering a toggle that cannot work. "unknown" is "not asked yet" (the first
 * getUserMedia prompts), so it must never read as blocked.
 */
export type CameraAccessStatus = "granted" | "blocked" | "unknown";

/** macOS Accessibility (click hook, see plans/video-editor-v2/03). "not-required" off macOS. */
export type AccessibilityStatus = "granted" | "denied" | "not-required";

/**
 * Discriminated result for the browser sign-in IPC calls. A structured AuthError does not
 * survive a *thrown* IPC error — Electron serializes anything thrown out of `ipcMain.handle`
 * down to its `.message` alone, so a `{ kind }` payload would arrive as an opaque Error and
 * every failure would collapse into the generic copy. Returning the error round-trips cleanly.
 */
export type AuthAttemptResult = { ok: true; status: AuthStatus } | { ok: false; error: AuthError };

/** Per-workspace setting overrides (ADR 0034). Every call names the scope or workspace it acts on. */
export interface SettingsScopeBridge {
  /** One scope: "all" (the All workspaces level) or a workspace id. */
  getScoped(scope: SettingsScope): Promise<ScopedSettings>;
  /** Override one key for a workspace; `null` removes it (Reset). Returns effective settings. */
  setOverride(
    workspaceId: string,
    key: OverridableKey,
    value: unknown | null,
  ): Promise<SetOverrideResult>;
  /** Remove several overrides of one workspace at once. */
  resetOverrides(
    workspaceId: string,
    keys: readonly OverridableKey[],
  ): Promise<ResetOverridesResult>;
  /** Make the workspace's values the All level's and drop every workspace's own override of them. */
  copyToAll(workspaceId: string, keys: readonly OverridableKey[]): Promise<CopyToAllResult>;
  /** Answer "This workspace brings its own settings"; `sha256` names the file the user saw. */
  resolvePending(
    workspaceId: string,
    decision: "use" | "ignore",
    sha256: string,
  ): Promise<ResolvePendingResult>;
}

/**
 * Workspaces (ADR 0032). Item-scoped calls elsewhere on this bridge carry the window's
 * workspace stamp, added by the preload: a call made before a switch and answered after it
 * rejects with `stale-workspace` instead of resolving with the other workspace's data.
 */
export interface WorkspacesBridge {
  list(): Promise<WorkspacesState>;
  /** The workspace this window's stamp names, read synchronously (null until it is known). */
  activeId(): string | null;
  /**
   * Folder picker, then adopt or initialize the folder and switch to it ("Use an existing
   * folder"). `activate: false` keeps it inactive ("Move to ▸ New workspace…").
   */
  add(options?: { activate?: boolean }): Promise<WorkspaceAddResult>;
  /**
   * New workspace: a new folder `Kaipu Record — <name>` next to the Default workspace's, with
   * only Kaipu's files in it, then a switch to it (unless `activate` is false).
   */
  create(input: {
    name: string;
    color: TagColor;
    activate?: boolean;
  }): Promise<WorkspaceCreateResult>;
  /**
   * Move items of the active workspace to `targetId`, one after another (ADR 0033). Stamped:
   * refused when the window's workspace is no longer the active one.
   */
  moveItems(request: MoveItemsRequest): Promise<MoveItemsResult>;
  /** Stop a group move: the move in flight finishes, no further one starts. */
  cancelMove(): Promise<void>;
  /** "Moving 3 of 12" while a group this window started runs. Returns an unsubscribe. */
  onMoveProgress(callback: (progress: MoveProgress) => void): () => void;
  /** Where `create` would put the folder, and whether it can be used. */
  checkLocation(name: string): Promise<LocationCheck>;
  /** Rename and/or recolor; written to the registry and to the folder's identity. */
  edit(input: WorkspaceEditRequest): Promise<WorkspaceEditResult>;
  /**
   * "Change folder…": the native folder picker, then point this workspace at the folder where
   * it now lives (moved in Finder, put in a Google Drive folder). Never moves or copies files;
   * refuses a folder that is not this workspace's, and while a recording or export runs.
   */
  relocate(id: string): Promise<WorkspaceRelocateResult>;
  switch(id: string): Promise<WorkspaceSwitchResult>;
  /** Unregister; nothing on disk changes. Refused for the active and the last one. */
  remove(id: string): Promise<WorkspaceRemoveResult>;
  /** Reveal the workspace's folder in Finder / Explorer (never creates it). */
  openFolder(id: string): Promise<void>;
  /** The one-time "New: workspaces" hint was dismissed. */
  dismissHint(): Promise<void>;
  /** After any registry change or switch, with the new state. */
  onChanged(callback: (state: WorkspacesState) => void): () => void;
  /**
   * The one handler that prepares this window for a switch: flush pending saves, resolve
   * unsaved editors and close them. Resolve false to cancel the switch. Returns an unsubscribe.
   */
  onPrepare(handler: () => Promise<boolean>): () => void;
}

export interface KaipuElectronAPI {
  /** Developer opt-in only; recordingReady remains false. */
  nativeCapture: NativeCaptureBridge;
  /** Feature flags pinned by `KAIPU_FLAG_OVERRIDES` (unpackaged builds only); empty otherwise. */
  readonly flagOverrides: Readonly<Partial<Record<FlagName, boolean>>>;
  /** Host OS (`process.platform`), exposed because the renderer must not read `process` itself. */
  readonly platform: string;
  /** The running app version (`app.getVersion()`), used by the version gate. */
  getAppVersion(): Promise<string>;
  /** Tell main the app shell has mounted and its IPC listeners are registered,
   *  so any window-triggered action queued during load can be flushed. */
  notifyReady(): void;
  /** Current auto-update status (for UI that mounts after the event fired). */
  getUpdateStatus(): Promise<UpdateStatus>;
  /**
   * Check for updates now. Resolves with the status the check produced, or the
   * current status unchanged when a check is refused (one already running, a
   * download in flight, or a build already waiting to install).
   */
  checkForUpdates(): Promise<UpdateStatus>;
  /** Subscribe to auto-update status changes. Returns an unsubscribe fn. */
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  /** Quit and install a downloaded update (the "Reiniciar" button). */
  installUpdate(): void;
  /** Read persisted app settings. */
  getSettings(): Promise<AppSettings>;
  /** Merge a partial settings change; persists + applies OS side effects; returns the result. */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Subscribe to persisted-settings changes from any window. Returns an unsubscribe fn. */
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;

  // ── Authentication ────────────────────────────────────────────────────
  /** Get the current authentication status. */
  getAuthStatus(): Promise<AuthStatus>;
  /** Open the system browser on the Kaipu sign-in (or sign-up) page. Resolves once the browser
   *  was asked to open; the sign-in itself completes later, through the `kaipu://` link or
   *  {@link submitSignInCode}, and arrives as an auth status change. Never rejects. */
  beginBrowserSignIn(
    intent: BrowserSignInIntent,
  ): Promise<{ ok: true } | { ok: false; error: AuthError }>;
  /** Stop waiting for the browser: a link or code that arrives afterwards is ignored. */
  cancelBrowserSignIn(): Promise<void>;
  /** Paste-code fallback for when the link cannot reach the app (unpackaged builds, blocked
   *  deep links). Never rejects on a bad code — see {@link AuthAttemptResult}. */
  submitSignInCode(code: string): Promise<AuthAttemptResult>;
  /** Subscribe to a browser sign-in that came back through the link but did not complete. */
  onBrowserSignInFailed(callback: (error: AuthError) => void): () => void;
  /** Sign out and clear the stored session. */
  signOut(): Promise<void>;
  /** Resend the verification email to the signed-in account. `ok: false` when signed out or
   *  the request failed — never rejects. On success returns when it was sent, which the main
   *  process has also persisted with the session so a remount does not forget it. */
  resendVerificationEmail(): Promise<{ ok: true; sentAt: number } | { ok: false }>;
  /** Subscribe to authentication status changes. Returns an unsubscribe fn. */
  onAuthStatusChanged(callback: (status: AuthStatus) => void): () => void;

  /**
   * Enumerate recordable sources via the main-process desktopCapturer. By default it
   * returns screens AND windows with thumbnails — what the picker shows. Pass
   * `{ withThumbnails: false }` for screens only and no captures, which is all a
   * default selection needs and costs milliseconds instead of a screenshot per window.
   */
  getScreenSources(options?: { withThumbnails?: boolean }): Promise<ScreenSource[]>;

  /** Capture Panel → main: resize the panel window to its measured content height. */
  resizeCapturePanel(height: number): void;
  /** Capture Panel → main: show & focus the main window, hiding the panel. */
  openMainWindow(): void;

  /** Read the current grant status of all media permissions (no system prompt). */
  checkPermissions(): Promise<PermissionStatus>;
  /**
   * Trigger the macOS permission prompt for one permission and resolve to its
   * resulting granted state. Screen recording has no async request API, so this
   * nudges the prompt via desktopCapturer and re-reads the status.
   */
  requestPermission(kind: PermissionKind): Promise<boolean>;
  /** "not-required" off macOS. Never prompts. */
  getAccessibilityStatus(): Promise<AccessibilityStatus>;
  /**
   * macOS: registers the app in the Accessibility list, shows the system prompt once, and
   * opens the pane. The only place this may be called from is the onboarding Accessibility
   * step or the Settings "Zoom on clicks" row (plans/video-editor-v2/03 § UI) — both are
   * user-initiated clicks, never anything on the recording path.
   */
  requestAccessibility(): Promise<AccessibilityStatus>;
  /** Deep-link System Settings to the relevant Privacy pane (for denied permissions). */
  openSystemSettings(kind: PermissionKind): Promise<void>;
  /** Camera access as a tri-state (no prompt). See {@link CameraAccessStatus}. */
  getCameraAccessStatus(): Promise<CameraAccessStatus>;
  /**
   * Camera bubble → main: resize the bubble to `size` while its grip is dragged, from its
   * anchored bottom-left corner. Not persisted (the grip writes `cameraBubble` through
   * `updateSettings` on release). Resolves the size actually applied once the range and
   * the recorded area clamp it.
   */
  previewCameraBubbleSize(size: number): Promise<number>;
  /** Camera bubble → main: the pointer went down on the bubble; a move may follow. */
  beginCameraBubbleMove(): void;
  /**
   * Camera bubble → main: move the bubble by the pointer's offset (DIP) since
   * {@link beginCameraBubbleMove}. Main keeps it inside the recorded area or the display.
   */
  moveCameraBubble(dx: number, dy: number): void;

  /** List recordings stored in the local vault. */
  listLocalRecordings(): Promise<LocalRecording[]>;
  /**
   * Rename a local item (NIW2-560, ADR 0035): saves the title and moves the file (and its
   * sidecars) to a name derived from it. `recording.id` is the id to use from now on.
   * `file` says what happened to the file; "kept-old-name" is not an error — the title
   * was saved. `assetId` is required: main resolves the item by it under the names lock,
   * following it if it moved since `id` was read and never touching another item that took
   * that name. Rejects when no item has `assetId` (message carries `ITEM_NOT_FOUND_MARKER`)
   * or when the title itself cannot be written.
   */
  renameLocalRecording(id: string, assetId: string, title: string): Promise<RenameResult>;
  /** Stamp a vault item as opened in an editor now (orders the Editor home). */
  markOpenedInEditor(id: string): Promise<void>;
  /**
   * The video editor holds this item while mounted (NIW2-560, ADR 0035): a rename keeps
   * the file's name ("editing") until `closeEditorSession`, or until the window goes away.
   * Serialized with renames in main; resolves the item's current id, which the editor
   * must load and write under, or null when no local item has `assetId`.
   */
  acquireEditorSession(assetId: string): Promise<string | null>;
  closeEditorSession(id: string): void;
  /** Every live tag with its item count, most used first. */
  listTags(): Promise<TagSummary[]>;
  /** Create a tag; rejects when the name (case-insensitively) is taken. */
  createTag(name: string, color?: TagColor): Promise<TagSummary>;
  renameTag(id: string, name: string): Promise<void>;
  recolorTag(id: string, color: TagColor): Promise<void>;
  /** Delete a tag and take it off every item. */
  deleteTag(id: string): Promise<void>;
  /** Replace a local item's tags; resolves to the ids actually stored. */
  setItemTags(itemId: string, tagIds: readonly string[]): Promise<string[]>;
  /**
   * Persist duration + poster the renderer decoded for a recording that had no
   * sidecar (hand-imported, or an interrupted finalize). Returns the re-described
   * recording, or null if the file vanished. See {@link RecordingBackfillMeta}.
   */
  backfillLocalRecordingMeta(
    id: string,
    meta: RecordingBackfillMeta,
  ): Promise<LocalRecording | null>;
  /** Delete a local recording from disk. */
  deleteLocalRecording(id: string): Promise<void>;
  /** Reveal a local recording in the OS file manager. */
  revealLocalRecording(id: string): Promise<void>;
  /**
   * NIW2-669: open a local recording in the OS default application. Rejects with the
   * OS error message when the file cannot be opened.
   */
  openLocalRecording(id: string): Promise<void>;
  /**
   * NIW2-669: absolute path of a local recording's file, or null when the id is unknown
   * or its file is gone.
   */
  localRecordingPath(id: string): Promise<string | null>;
  /**
   * NIW2-217: write an exported GIF into the vault as `<id>.gif` (+ sidecar and
   * thumbnail). Main validates the bytes (GIF89a, ≤ 64 MB) and picks the path.
   */
  gifSave(bytes: ArrayBuffer, meta: GifSaveMeta): Promise<LocalRecording>;
  /**
   * NIW2-217: start a native drag of a vault item's file (call from `dragstart`).
   * NIW2-218: `name` drags it under a friendly file name ("Demo (10 MB).mp4") instead of the
   * vault id — main sanitizes it and drags a temporary link to the vault file.
   */
  startFileDrag(id: string, name?: string): void;
  /**
   * NIW2-579: open a file dialog for outside videos (mp4, mov, m4v, webm) and copy each one
   * picked into the vault as a recording. `canceled` when the dialog was closed.
   */
  importVideos(): Promise<ImportVideoResult>;
  /** NIW2-579: import dropped files by path (see `pathForFile`); main validates every path. */
  importVideoFiles(paths: readonly string[]): Promise<ImportVideoResult>;
  /**
   * The absolute path of a `File` from a drop (Electron's `webUtils.getPathForFile`); "" for
   * a file with no path on disk (e.g. made in the page).
   */
  pathForFile(file: File): string;
  /** NIW2-218: tell main whether a background export is running (close/quit confirmation). */
  setExportActive(active: boolean): void;
  /**
   * NIW2-561: called before an export reads its source; main takes the export's vault
   * lease. Rejects with the maintenance marker while files are being fixed.
   */
  beginExport(): Promise<void>;
  /** NIW2-218: main asks to cancel the running export (the user confirmed close/quit). */
  onExportCommand(callback: (command: "cancel") => void): () => void;

  /** Workspaces (ADR 0032): the registry, the active one, and the switch. */
  workspaces: WorkspacesBridge;
  /** Per-workspace setting overrides and their inheritance (ADR 0034). */
  settingsScope: SettingsScopeBridge;
  /** The signed-in account's cloud capacity; never zeros for a failed query. */
  getStorageUsage(): Promise<StorageUsageResult>;
  /** Subscribe to vault-folder changes (so open library pages re-list). Returns an unsubscribe fn. */
  onLibraryChanged(callback: () => void): () => void;
  /** NIW2-561: scan the vault for drift ("Check and fix files"). Never writes. */
  reconcileScan(): Promise<ReconcileScanResult>;
  /**
   * NIW2-561: "Fix all", in maintenance mode. `skip` (NIW2-598) lists the finding paths the
   * user unticked; they are left as they are this run.
   */
  reconcileFix(skip?: string[]): Promise<ReconcileFixResult>;
  /** NIW2-561: stop waiting for the vault to be idle; no effect once files are being fixed. */
  reconcileCancel(): Promise<void>;
  onReconcileProgress(callback: (progress: ReconcileProgress) => void): () => void;
  /** NIW2-561: maintenance mode ended; editors retry their latest pending save. */
  onLibraryMaintenanceEnded(callback: () => void): () => void;
  /** One entry per logical item (local, cloud, or both) plus vault/catalog status. */
  listLibraryItems(): Promise<LibraryListResult>;
  /**
   * Re-fetch the cloud catalog for the signed-in account; resolves with why it could not
   * (never rejects for a cloud failure). Main skips a fetch made less than 30 s ago unless
   * `force` is set (the Sync button).
   */
  refreshCloudCatalog(force?: boolean): Promise<CatalogRefreshResult>;
  /** Remove the local media file of an item that has an identical cloud copy. */
  removeLocalCopy(id: string): Promise<RemoveLocalCopyResult>;

  // ── Recording engine (used by the main/recorder window) ───────────────
  /**
   * Open a disk-writer session; returns the temp path. `kind` "recording" opens a take, whose
   * partial is kept when its page goes away; "export" a background export's session, whose
   * partial is discarded then, and which is not a take (the camera bubble's protection follows
   * the live take alone). "webcam" opens the open recording take's second session, for its
   * webcam file (ADR 0037). Required, so no caller is a take by omission.
   */
  recordingCreate(
    sessionId: string,
    kind: "recording" | "export" | "webcam",
  ): Promise<{ tempPath: string }>;
  /** Write a chunk at an exact byte position (positional, not append) to the `kind` session. */
  recordingWrite(
    sessionId: string,
    data: ArrayBuffer,
    position: number,
    kind?: RecordingWriterKind,
  ): void;
  /** Close the file, move it into the vault, return the new recording. */
  recordingFinalize(sessionId: string, meta: RecordingFinalizeMeta): Promise<LocalRecording>;
  /** Discard a failed take (delete its temp files: the screen's and the webcam's). */
  recordingAbort(sessionId: string): Promise<void>;
  /** Byte size of an open session's temp file, after every queued write landed (NIW2-218). */
  recordingStat(sessionId: string, kind?: RecordingWriterKind): Promise<number>;
  /**
   * The take records no (more) webcam file: main stops excluding the camera bubble from the
   * screen capture, so the face is in the screen recording instead. Resolves once main applied
   * it, so a caller can wait for it before starting the screen capture.
   */
  recordingWebcamEnded(sessionId: string): Promise<void>;
  /**
   * Whether this OS can record the webcam as its own file: only where the camera bubble can
   * leave the screen capture. False on Windows before 10 2004, where a take keeps the face in
   * the screen recording and records no webcam file (the legacy path, by design).
   */
  recordingWebcamTrackSupported(): Promise<boolean>;
  /** Push a live tick (elapsed/levels/status) to the hub for the bar. */
  recordingReportTick(tick: RecordingTick): void;
  /**
   * Recorder only: report the mic's 5 bars (0..1) for the settings meter. Sent only while
   * {@link onMicLevelsListening} / {@link getMicLevelsListening} say a window listens.
   */
  recordingReportMicLevels(levels: number[]): void;
  /** Recorder only: whether any window currently subscribes to the mic levels. */
  getMicLevelsListening(): Promise<boolean>;
  /** Recorder only: a window started (true) or stopped (false) listening to the mic levels. */
  onMicLevelsListening(callback: (listening: boolean) => void): () => void;
  /**
   * Any window: receive the mic's 5 bars (0..1) during a take. Registers interest with main
   * (the recorder sends levels only while someone listens) and drops it on unsubscribe or
   * when the window is destroyed.
   */
  subscribeMicLevels(callback: (levels: number[]) => void): () => void;
  /** Tell the hub recording started: hide main window, show the bar. */
  recordingStart(info: RecordingStartInfo): void;
  /**
   * Hide the main window, before `recordingStart`; true when it was on screen, so the
   * recorder waits for it to leave the capture before the take encodes.
   */
  recordingHideMainWindow(): Promise<boolean>;
  /** Tell the hub recording ended: hide the bar, restore main window. */
  recordingStop(): void;
  /** Start sampling the pointer for this writer session. `enabled: false` = no track (window source, unknown display). */
  /** `area`: normalize the track to that part of the display (ADR 0030). */
  cursorTrackStart(
    sessionId: string,
    sourceId: string,
    area?: RecordingArea,
  ): Promise<{ enabled: boolean }>;
  /** Main-process performance.now(), for the renderer→main clock handshake. */
  cursorClockNow(): Promise<number>;
  /** Video time 0 of this session, in main-clock ms. */
  cursorTrackAnchor(sessionId: string, t0MainMs: number, quality: "exact" | "estimated"): void;
  cursorTrackPause(sessionId: string, atMainMs: number): void;
  cursorTrackResume(sessionId: string, atMainMs: number): void;
  /** Recorder window subscribes to commands from the bar (pause/resume/stop). */
  onRecordingCommand(callback: (command: ControlCommand) => void): () => void;

  // ── Control bar window ────────────────────────────────────────────────
  /** Bar subscribes to live ticks. Returns an unsubscribe fn. */
  onControlTick(callback: (tick: RecordingTick) => void): () => void;
  /** Bar sends a command to the hub. */
  controlCommand(command: ControlCommand): void;

  // ── Global recording activity (any window) ────────────────────────────
  /** Current recording activity — query on mount in case a recording is already running. */
  getRecordingState(): Promise<RecordingActivity>;
  /** Subscribe to recording activity changes (start/stop/pause/resume). */
  onRecordingState(callback: (state: RecordingActivity) => void): () => void;

  // ── Shared recording settings (any window) ────────────────────────────
  /** Current shared settings — query on mount. */
  getRecordingSettings(): Promise<RecordingSettings>;
  /** Merge a partial settings change (broadcast to every window; drives the bubble). */
  updateRecordingSettings(patch: Partial<RecordingSettings>): void;
  /** Subscribe to settings changes from any window. */
  onRecordingSettingsChanged(callback: (settings: RecordingSettings) => void): () => void;

  // ── Start from the Capture Panel ──────────────────────────────────────
  /** Capture Panel → main: open the main window and start recording there. */
  requestStartRecording(): void;
  /** Record page subscribes so a panel request triggers its start. */
  onRequestStartRecording(callback: () => void): () => void;
  /** Capture Panel "Change" → main: open the main window + Record page's source picker. */
  requestChooseSource(): void;
  /** Record page subscribes so a panel "Change" opens its source picker. */
  /**
   * `startOnPick`: the picker was opened as the Window mode of "Start recording", so picking
   * a source also starts the countdown.
   */
  onRequestChooseSource(callback: (request: { startOnPick: boolean }) => void): () => void;
  /** Capture Panel → main: run the interactive screenshot capture (same as ⌘⇧1). */
  requestCaptureScreenshot(mode: CaptureMode): void;
  /**
   * Record page / Capture Panel → main: open the recording selector, in `mode` (a mode
   * chip, which also makes it the last used one) or in the last used mode (Start).
   */
  requestRecordSelector(mode?: CaptureMode): void;
  /** Main renderer → main: the recorder's countdown phase (see `RecorderPhaseReport`). */
  reportRecorderPhase(report: RecorderPhaseReport): void;
  /**
   * Main renderer → main: resolves once the countdown is visible — at once without a region,
   * when the shade window has shown the first tick with one.
   */
  waitForCountdownVisible(): Promise<void>;
  /** Main renderer → main: a `[record-timing]` mark (see `RecordTimingKind`). */
  reportRecordTiming(label: string, kind: RecordTimingKind): void;
  /** Recording shade window: what to paint (countdown tick or recording). */
  onRecordingShadeState(callback: (state: RecordingShadeView) => void): () => void;

  // ── Global shortcuts ──────────────────────────────────────────────────
  /** Per-action registration state of the global shortcuts (false = unavailable). */
  getShortcutStatus(): Promise<Record<ShortcutAction, boolean>>;
  /** Pause global shortcuts so a combo reaches the renderer while rebinding. */
  suspendShortcuts(): void;
  /** Resume (re-register) global shortcuts after rebinding. */
  resumeShortcuts(): void;
  /** Subscribe to every global shortcut press (its action), after main ran it. */
  onShortcutFired(callback: (action: ShortcutAction) => void): () => void;

  // ── Screenshots ───────────────────────────────────────────────────────
  /** Run a capture in `mode`; always answers captured, cancelled or unsupported. */
  /** `intent: "record"` opens the overlay to choose what to record (ADR 0030). */
  /**
   * `options.insert: true` takes the shot for the open image editor's canvas only: main skips
   * the capture policy (no save, no copy, no toast) and answers the bytes with `saved: null`.
   * Answers `cancelled` during a take.
   */
  captureScreenshot(
    mode: CaptureMode,
    intent?: CaptureIntent,
    options?: { insert?: boolean },
  ): Promise<CaptureResult>;
  /** Modes this platform can capture; an absent mode renders its entry point disabled. */
  screenshotSupportedModes(): Promise<CaptureMode[]>;
  /**
   * Subscribe to the global capture hotkey broadcast (`{ mode }`) from main. Returns an
   * unsubscribe fn. The renderer owns navigation so it runs the capture flow.
   */
  onCaptureScreenshotHotkey(callback: (request: CaptureRequestPayload) => void): () => void;
  /**
   * Bring the app back to the front after a successful capture. The renderer
   * calls this *after* it has navigated to the editor, so the window reappears
   * already showing the result (no flash of the previous page). Main hides the
   * window for the duration of the capture so the app isn't in the shot.
   */
  revealAfterCapture(): void;
  /** Tell main the resolved `capture-while-recording` flag, so a shortcut during a take can route. */
  reportCaptureWhileRecording(enabled: boolean): void;
  /** Tell main the resolved `image-text` flag, so it can warm up text recognition early. */
  reportImageText(enabled: boolean): void;
  /** Only used by the capture overlay windows; see `CaptureOverlayBridge`. */
  captureOverlay: CaptureOverlayBridge;
  /** Only used by the capture toast window; see `CaptureToastBridge`. */
  captureToast: CaptureToastBridge;
  /**
   * Float "Your video is ready" on the desktop, outside the main window. Resolves false when
   * the window could not be created; the caller then shows the card in-app instead.
   */
  showRecordingReady(payload: RecordingReadyPayload): Promise<boolean>;
  /** Only used by the "Your video is ready" window; see `RecordingReadyCardBridge`. */
  recordingReadyCard: RecordingReadyCardBridge;
  /**
   * An action on the floating "Your video is ready" card: main has closed it and shown this
   * window; the renderer navigates. Returns an unsubscribe fn.
   */
  onRecordingReadyOpen(callback: (handOff: RecordingReadyHandOff) => void): () => void;
  /**
   * The capture toast asked to show a saved screenshot (Annotate, Open in Library). The
   * renderer navigates, then calls `revealAfterCapture()`. Returns an unsubscribe fn.
   */
  onOpenSavedScreenshot(callback: (request: OpenSavedScreenshotRequest) => void): () => void;
  /**
   * The capture toast's Annotate on a copy-only capture: open these bytes in the editor
   * (`origin: "quiet"`), then call `revealAfterCapture()`. Returns an unsubscribe fn.
   */
  onOpenQuietCapture(callback: (capture: QuietCaptureHandOff) => void): () => void;
  /**
   * Toggle "editor mode" window sizing: when active, main raises the minimum
   * size and grows the window so the screenshot editor has room; inactive
   * restores the normal minimum. The renderer calls true on editor mount, false
   * on unmount.
   */
  /**
   * Resize the window to the preset this screen wants and set its minimum.
   * Main clamps both to the display's work area.
   */
  applyWindowPreset(preset: WindowPresetName): void;
  /** Mirror the capture panel's selected mode in the menu-bar icon. */
  setTrayMode(mode: "record" | "screenshot"): void;
  /**
   * Toggle "onboarding mode" window sizing. The first-run takeover is a fixed
   * amount of content — a 96px mark, a headline, and up to four permission
   * cards — that cannot reflow any smaller, so below this floor it stops being
   * a page and becomes a scroll well. The overlay calls true on mount, false on
   * unmount.
   */
  setOnboardingWindowMode(active: boolean): void;
  /** Put a PNG on the system clipboard. */
  copyImageToClipboard(png: ArrayBuffer): Promise<void>;
  /** Copy a saved screenshot to the clipboard by id (main reads the vault file). */
  copyScreenshotById(id: string): Promise<void>;
  /** Read a saved screenshot's PNG bytes by id (re-opening it in the editor). */
  readScreenshotBytes(id: string): Promise<ArrayBuffer>;
  /**
   * The editable canvas document saved beside a screenshot, with its image assets, or null
   * when there is none or it is unusable (missing, oversized, corrupt, an asset absent).
   * Any other read error rejects. Either way the editor opens the flattened PNG.
   */
  readScreenshotCanvas(id: string): Promise<CanvasReadResult | null>;
  /**
   * When the canvas document beside a screenshot was last written, or null when no document
   * file exists. `readScreenshotCanvas` answers null for a missing and an unusable document
   * alike; this tells them apart (a null read with a document present is "unreadable"), and
   * gives the saved time. Any other stat error (permissions, I/O) rejects with its code.
   */
  statScreenshotCanvas(id: string): Promise<{ savedAt: number } | null>;
  /**
   * The words recognized in one image of the editor (ADR 0055). Served from
   * `.kaipu/<id>.text.json` when the cached hash matches the bytes; otherwise the platform
   * backend runs (up to 30 s or more the first time on a Mac, while Vision compiles its
   * model). A recognition failure is `{ status: "unavailable" }`, never a rejection; the call
   * still rejects while the library is busy (maintenance, a workspace switch), like every
   * library call.
   */
  recognizeScreenshotText(request: TextRecognitionRequest): Promise<TextRecognitionResult>;
  /** The image on the system clipboard as PNG, or null when it holds no image. */
  readClipboardImage(): Promise<{ png: ArrayBuffer; width: number; height: number } | null>;
  /** The clipboard image's size, or null when it holds no image. No bytes cross IPC. */
  peekClipboardImage(): Promise<{ width: number; height: number } | null>;
  /**
   * Write a PNG into the vault and return the stored item. With `overwriteId` it
   * replaces that existing screenshot (keeping its createdAt), and `overwriteAssetId` is
   * required with it: main follows the item if a rename moved it and refuses an overwrite
   * without it (NIW2-560). Without `overwriteId`, it creates a new item named after the title.
   */
  saveScreenshot(
    png: ArrayBuffer,
    /** `manual`: the user pressed Save (stamps the Editor home's "Saved"), not the auto-save. */
    meta: {
      title: string;
      overwriteId?: string;
      overwriteAssetId?: string;
      manual?: boolean;
      /** The editable document and assets stored beside the PNG (ADR 0053). */
      canvas?: CanvasSavePayload;
      /** Recognized words for the assets in `canvas`, minus words under baked redactions. */
      text?: TextCacheSavePayload;
      /** A frame capture of a video: its asset id and the second on screen. New items only. */
      source?: { videoAssetId: string; timeSeconds: number | null };
    },
  ): Promise<LocalRecording>;
  /**
   * Ask where to put an exported capture (a native save dialog seeded with
   * `suggestedName`.`extension`) and write `bytes` there. Resolves the written
   * path, or null when the user cancelled. Exports live outside the vault: they
   * are files to hand to someone, not library items.
   */
  exportScreenshotFile(
    bytes: ArrayBuffer,
    meta: { suggestedName: string; extension: string },
  ): Promise<{ path: string } | null>;

  // ── Analytics ─────────────────────────────────────────────────────────
  /** Forward a serialized exception (+ origin/context) to the main-process sink. */
  reportException(
    payload: SerializedError,
    origin: string,
    context?: Record<string, unknown>,
  ): void;

  // ── Video-editor session persistence ──────────────────────────────────────
  /**
   * Persist an edit session next to the recording's existing vault sidecars.
   * Called once on export (not on every edit — saves are intentionally sparse).
   * Slide asset bytes are written as individual `.png` files; assets no longer
   * referenced in `assets` are pruned so the vault doesn't accumulate orphans.
   */
  saveVideoEditSession(
    id: string,
    sessionJson: string,
    assets: { assetId: string; bytes: ArrayBuffer }[],
    /**
     * Pass true only for the save that follows a successful export: it stamps this
     * scene as the one burned into a file, which is what clears the library's
     * "not exported" badge. Every other save leaves the stamp alone.
     */
    exported?: boolean,
  ): Promise<void>;
  /**
   * Load a previously saved edit session for `id`. Returns `null` when no session
   * file exists (first open, or after the session was purged by a delete).
   */
  loadVideoEditSession(
    id: string,
  ): Promise<{ sessionJson: string; assets: { assetId: string; bytes: ArrayBuffer }[] } | null>;
  /** Raw `.cursor.json` for a recording, or null when it has none. Parse with parseCursorTrack. */
  loadCursorTrack(id: string): Promise<string | null>;
}
