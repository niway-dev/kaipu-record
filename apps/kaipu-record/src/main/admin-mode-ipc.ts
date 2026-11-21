import { BrowserWindow, ipcMain } from "electron";
import { adminModeState, type AdminModeState, type AdminSession } from "@shared/admin-mode";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { launchAdminMode } from "./admin-mode";

export interface AdminModeIpcDeps {
  /** The stored admin permission of the current session; null when signed out. */
  session: () => AdminSession | null;
  /** The `adminMode` preference. */
  setting: () => boolean;
  /** Persist the preference (it never changes the running mode). */
  setSetting: (value: boolean) => void;
  /** Quit through the guards and start the app again. */
  relaunch: () => void;
}

/**
 * The plumbing the Settings UI reads (ADR 0067): the state, the preference, and "Restart now".
 * Returns `notifyChanged`, which main calls when the permission or the preference changes so every
 * open window hears the new state.
 */
export function registerAdminModeIpc(deps: AdminModeIpcDeps): { notifyChanged: () => void } {
  const state = (): AdminModeState =>
    adminModeState({
      effective: launchAdminMode(),
      adminModeSetting: deps.setting(),
      session: deps.session(),
    });

  ipcMain.handle(IPC_CHANNELS.adminModeGetState, (): AdminModeState => state());
  ipcMain.handle(IPC_CHANNELS.adminModeSet, (_event, value: unknown): AdminModeState => {
    if (typeof value === "boolean") deps.setSetting(value);
    return state();
  });
  ipcMain.handle(IPC_CHANNELS.adminModeRelaunch, (): void => deps.relaunch());

  return {
    notifyChanged: () => {
      const next = state();
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.adminModeChanged, next);
      }
    },
  };
}
