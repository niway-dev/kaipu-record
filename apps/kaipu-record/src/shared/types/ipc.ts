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
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
