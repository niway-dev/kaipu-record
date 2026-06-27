/**
 * Contract for the renderer-facing `window.electronAPI` bridge (implemented in
 * `src/preload`, typed for the renderer via `src/preload/index.d.ts`). Pure types.
 */

import type { LocalRecording, VaultDirectory } from "./library-storage";
import type {
  ControlCommand,
  RecordingActivity,
  RecordingFinalizeMeta,
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

  // ── Camera bubble ─────────────────────────────────────────────────────
  /** Show/hide the floating webcam bubble (follows the Camera toggle). */
  setCameraBubble(enabled: boolean): void;
}
