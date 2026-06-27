/**
 * Shared IPC contract between the main and renderer processes.
 *
 * This file is PURE: it must not import from `electron`, `node:*`, or any
 * renderer-only API. Both processes import these types so the contract is
 * verified by TypeScript at compile time (this is what replaces runtime
 * tests for the preload bridge).
 */

export type Theme = "light" | "dark" | "system";

export interface AppSettings {
  theme: Theme;
  launchAtLogin: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  launchAtLogin: false,
};

/**
 * Names of the IPC channels exposed by the preload bridge.
 * Using a const map keeps main and renderer in sync.
 */
export const IPC_CHANNELS = {
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
  // Show/hide the floating camera bubble (driven by the Camera toggle).
  cameraBubbleSet: "camera:set",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** `saving` covers the brief finalize/encode-flush window after Stop. */
export type RecordingStatus = "recording" | "paused" | "saving";

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
