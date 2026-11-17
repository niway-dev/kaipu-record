import { app, BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { changeFlagOverride, onActiveFlagOverridesChanged } from "./flag-overrides";
import { applyImageTextOverride } from "./screenshots/text-recognition-service";

/**
 * The Developer page's feature-flag toggles. A change goes to every open window right away
 * (a window only reads `--kaipu-flag-overrides=` at creation, so the launch argument cannot
 * do it) and to the main-process readers of `activeFlagOverrides`. A packaged app refuses it.
 */
export function registerFlagOverridesIpc(): void {
  ipcMain.handle(IPC_CHANNELS.flagOverrideSet, (_event, name: unknown, value: unknown) =>
    changeFlagOverride(String(name), value, { isPackaged: app.isPackaged }),
  );
  onActiveFlagOverridesChanged((overrides) => {
    applyImageTextOverride(overrides["image-text"]);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.flagOverridesChanged, overrides);
      }
    }
  });
}
