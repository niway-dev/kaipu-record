import { BrowserWindow, ipcMain } from "electron";
import { adminModeState, type AdminModeState, type AdminSession } from "@shared/admin-mode";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { launchAdminMode } from "./admin-mode";

export interface AdminModeIpcDeps {
  /** The main window; only it may change the preference or restart the app. */
  getMainWindow: () => BrowserWindow | null;
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

  // The read stays open to every window; the two mutating handlers are main-window only, like auth.
  function requireMainWindow(event: Electron.IpcMainInvokeEvent): void {
    if (event.sender !== deps.getMainWindow()?.webContents) {
      throw new Error("admin mode IPC calls are only accepted from the main window");
    }
  }

  ipcMain.handle(IPC_CHANNELS.adminModeGetState, (): AdminModeState => state());
  ipcMain.handle(IPC_CHANNELS.adminModeSet, (event, value: unknown): AdminModeState => {
    requireMainWindow(event);
    if (typeof value === "boolean") deps.setSetting(value);
    return state();
  });
  ipcMain.handle(IPC_CHANNELS.adminModeRelaunch, (event): void => {
    requireMainWindow(event);
    deps.relaunch();
  });

  return {
    notifyChanged: () => {
      const next = state();
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.adminModeChanged, next);
      }
    },
  };
}
