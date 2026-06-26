import { join } from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type { VaultDirectory } from "@shared/types";
import { LibraryVault } from "./library-vault";
import { resetVaultDirectory, setVaultDirectory, vaultDirectory } from "./vault-location";

/** A fresh vault bound to the *current* recordings folder (which can change). */
function currentVault(): LibraryVault {
  return new LibraryVault(vaultDirectory().path);
}

/** Absolute path to a recording's real video file in the current vault. */
export async function recordingFilePath(id: string): Promise<string> {
  return currentVault().filePath(id);
}

/** Absolute path to a recording's thumbnail jpg (may not exist). */
export function thumbnailFilePath(id: string): string {
  return join(vaultDirectory().path, ".kaipu", `${id}.jpg`);
}

export function registerLibraryVaultHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.listLocalRecordings, () => currentVault().list());
  ipcMain.handle(IPC_CHANNELS.renameLocalRecording, (_event, id: string, title: string) =>
    currentVault().rename(id, title),
  );
  ipcMain.handle(IPC_CHANNELS.deleteLocalRecording, (_event, id: string) =>
    currentVault().remove(id),
  );
  ipcMain.handle(IPC_CHANNELS.revealLocalRecording, async (_event, id: string) =>
    shell.showItemInFolder(await currentVault().filePath(id)),
  );

  ipcMain.handle(IPC_CHANNELS.getVaultDirectory, (): VaultDirectory => vaultDirectory());

  ipcMain.handle(
    IPC_CHANNELS.chooseVaultDirectory,
    async (event): Promise<VaultDirectory | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: "Choose recordings folder",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: vaultDirectory().path,
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);

      const chosen = result.filePaths[0];
      if (result.canceled || !chosen) return null;

      setVaultDirectory(chosen);
      return vaultDirectory();
    },
  );

  ipcMain.handle(IPC_CHANNELS.resetVaultDirectory, (): VaultDirectory => {
    resetVaultDirectory();
    return vaultDirectory();
  });
}
