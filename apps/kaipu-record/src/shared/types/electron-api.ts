/**
 * Contract for the renderer-facing `window.electronAPI` bridge (implemented in
 * `src/preload`, typed for the renderer via `src/preload/index.d.ts`). Pure types.
 */

import type { SerializedError } from "../analytics";
import type { AppSettings, ShortcutAction, UpdateStatus } from "./ipc";
import type { LocalRecording, VaultDirectory } from "./library-storage";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingFinalizeMeta,
  RecordingSettings,
  RecordingStartInfo,
  RecordingTick,
} from "./ipc";

/** A capture source returned by the screen picker — includes a base64 thumbnail. */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  type: "screen" | "window";
}

/** macOS media permissions the recorder cares about. */
export type PermissionKind = "screen" | "microphone" | "camera";

/** Whether each permission is currently granted. */
export type PermissionStatus = Record<PermissionKind, boolean>;

export interface KaipuElectronAPI {
  /** The running app version (`app.getVersion()`), used by the version gate. */
  getAppVersion(): Promise<string>;
  /** Tell main the app shell has mounted and its IPC listeners are registered,
   *  so any window-triggered action queued during load can be flushed. */
  notifyReady(): void;
  /** Current auto-update status (for UI that mounts after the event fired). */
  getUpdateStatus(): Promise<UpdateStatus>;
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

  /** Enumerate available screens and windows via the main-process desktopCapturer. */
  getScreenSources(): Promise<ScreenSource[]>;

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
  /** Deep-link System Settings to the relevant Privacy pane (for denied permissions). */
  openSystemSettings(kind: PermissionKind): Promise<void>;

  /** List recordings stored in the local vault. */
  listLocalRecordings(): Promise<LocalRecording[]>;
  /** Rename a local recording (updates sidecar metadata; the file is untouched). */
  renameLocalRecording(id: string, title: string): Promise<void>;
  /** Delete a local recording from disk. */
  deleteLocalRecording(id: string): Promise<void>;
  /** Reveal a local recording in the OS file manager. */
  revealLocalRecording(id: string): Promise<void>;

  /** Current recordings-folder location (custom or platform default). */
  getVaultDirectory(): Promise<VaultDirectory>;
  /** Open a folder picker; persists & returns the new location, or null if cancelled. */
  chooseVaultDirectory(): Promise<VaultDirectory | null>;
  /** Reset the recordings folder back to the platform default. */
  resetVaultDirectory(): Promise<VaultDirectory>;
  /** Subscribe to vault-folder changes (so open library pages re-list). Returns an unsubscribe fn. */
  onLibraryChanged(callback: () => void): () => void;

  // ── Recording engine (used by the main/recorder window) ───────────────
  /** Open a disk-writer session; returns the temp path. */
  recordingCreate(sessionId: string): Promise<{ tempPath: string }>;
  /** Write a chunk at an exact byte position (positional, not append). */
  recordingWrite(sessionId: string, data: ArrayBuffer, position: number): void;
  /** Close the file, move it into the vault, return the new recording. */
  recordingFinalize(sessionId: string, meta: RecordingFinalizeMeta): Promise<LocalRecording>;
  /** Discard a failed session (delete temp). */
  recordingAbort(sessionId: string): Promise<void>;
  /** Push a live tick (elapsed/levels/status) to the hub for the bar. */
  recordingReportTick(tick: RecordingTick): void;
  /** Tell the hub recording started: hide main window, show the bar. */
  recordingStart(info: RecordingStartInfo): void;
  /** Tell the hub recording ended: hide the bar, restore main window. */
  recordingStop(): void;
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
  onRequestChooseSource(callback: () => void): () => void;
  /** Capture Panel → main: run the interactive screenshot capture (same as ⌘⌃X). */
  requestCaptureScreenshot(): void;

  // ── Global shortcuts ──────────────────────────────────────────────────
  /** Per-action registration state of the global shortcuts (false = unavailable). */
  getShortcutStatus(): Promise<Record<ShortcutAction, boolean>>;
  /** Pause global shortcuts so a combo reaches the renderer while rebinding. */
  suspendShortcuts(): void;
  /** Resume (re-register) global shortcuts after rebinding. */
  resumeShortcuts(): void;

  // ── Screenshots ───────────────────────────────────────────────────────
  /** Run the interactive region capture; resolves null if the user cancelled. */
  captureScreenshot(): Promise<{ png: ArrayBuffer; width: number; height: number } | null>;
  /**
   * Subscribe to the global `⌘⌃X` hotkey broadcast from main. Returns an
   * unsubscribe fn. The renderer owns navigation so it runs the capture flow.
   */
  onCaptureScreenshotHotkey(callback: () => void): () => void;
  /**
   * Bring the app back to the front after a successful capture. The renderer
   * calls this *after* it has navigated to the editor, so the window reappears
   * already showing the result (no flash of the previous page). Main hides the
   * window for the duration of the capture so the app isn't in the shot.
   */
  revealAfterCapture(): void;
  /**
   * Toggle "editor mode" window sizing: when active, main raises the minimum
   * size and grows the window so the screenshot editor has room; inactive
   * restores the normal minimum. The renderer calls true on editor mount, false
   * on unmount.
   */
  setEditorWindowMode(active: boolean): void;
  /** Put a PNG on the system clipboard. */
  copyImageToClipboard(png: ArrayBuffer): Promise<void>;
  /** Copy a saved screenshot to the clipboard by id (main reads the vault file). */
  copyScreenshotById(id: string): Promise<void>;
  /** Read a saved screenshot's PNG bytes by id (re-opening it in the editor). */
  readScreenshotBytes(id: string): Promise<ArrayBuffer>;
  /**
   * Write a PNG into the vault and return the stored item. With `overwriteId` it
   * replaces that existing screenshot (keeping its createdAt); without, it creates
   * a new timestamped item.
   */
  saveScreenshot(
    png: ArrayBuffer,
    meta: { title: string; overwriteId?: string },
  ): Promise<LocalRecording>;

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
  ): Promise<void>;
  /**
   * Load a previously saved edit session for `id`. Returns `null` when no session
   * file exists (first open, or after the session was purged by a delete).
   */
  loadVideoEditSession(
    id: string,
  ): Promise<{ sessionJson: string; assets: { assetId: string; bytes: ArrayBuffer }[] } | null>;
}
