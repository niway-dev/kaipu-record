import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type { VaultDirectory } from "@shared/types";
import { createMainTranslator } from "@kaipu/i18n/main";
import { getAppSettings } from "../infrastructure/settings-store";
import { LibraryVault } from "./library-vault";
import { resetVaultDirectory, setVaultDirectory, vaultDirectory } from "./vault-location";
import { deleteVideoEditSession, registerVideoEditSessionHandlers } from "./video-edit-session";

/** Tell every window the vault folder changed so open pages re-list. */
function broadcastLibraryChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.libraryChanged);
  }
}

/** True if we can create AND write into `dir` (probes with a temp file). */
async function isWritableDirectory(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, ".kaipu-write-test");
    await writeFile(probe, "");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** A fresh vault bound to the *current* recordings folder (which can change). */
export function currentVault(): LibraryVault {
  return new LibraryVault(vaultDirectory().path);
}

/** Absolute path to a recording's real video file in the current vault. */
export async function recordingFilePath(id: string): Promise<string> {
  return currentVault().filePath(id);
}

export async function screenshotFilePath(id: string): Promise<string> {
  return currentVault().filePath(id); // resolves <id>.png
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
  ipcMain.handle(IPC_CHANNELS.deleteLocalRecording, async (_event, id: string) => {
    await currentVault().remove(id);
    // Best-effort: a missing session must never block the delete.
    await deleteVideoEditSession(id).catch(() => {});
  });
  ipcMain.handle(IPC_CHANNELS.revealLocalRecording, async (_event, id: string) =>
    shell.showItemInFolder(await currentVault().filePath(id)),
  );

  ipcMain.handle(IPC_CHANNELS.getVaultDirectory, (): VaultDirectory => vaultDirectory());

  ipcMain.handle(
    IPC_CHANNELS.chooseVaultDirectory,
    async (event): Promise<VaultDirectory | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const t = createMainTranslator(getAppSettings().locale);
      const options: Electron.OpenDialogOptions = {
        title: t("dialogs.chooseFolder"),
        properties: ["openDirectory", "createDirectory"],
        defaultPath: vaultDirectory().path,
      };
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);

      const chosen = result.filePaths[0];
      if (result.canceled || !chosen) return null;
      // Picking the current folder is a no-op — no warning, no re-list.
      if (chosen === vaultDirectory().path) return vaultDirectory();

      // Validate before committing: a folder we can't write into would make every
      // future recording/screenshot fail with no obvious cause.
      if (!(await isWritableDirectory(chosen))) {
        const message = { type: "error" as const, message: t("dialogs.folderUnusable") };
        const detail = t("dialogs.folderUnusableDetail");
        await (window
          ? dialog.showMessageBox(window, { ...message, detail })
          : dialog.showMessageBox({ ...message, detail }));
        return null;
      }

      // Warn that existing items stay put — the Library will show the NEW folder's
      // contents, which otherwise reads as "my recordings vanished".
      const confirm = {
        type: "question" as const,
        buttons: [t("dialogs.cancel"), t("dialogs.changeFolder")],
        defaultId: 1,
        cancelId: 0,
        message: t("dialogs.changeFolderTitle"),
        detail: t("dialogs.changeFolderDetail"),
      };
      const choice = await (window
        ? dialog.showMessageBox(window, confirm)
        : dialog.showMessageBox(confirm));
      if (choice.response !== 1) return null;

      setVaultDirectory(chosen);
      broadcastLibraryChanged();
      return vaultDirectory();
    },
  );

  ipcMain.handle(IPC_CHANNELS.resetVaultDirectory, (): VaultDirectory => {
    resetVaultDirectory();
    broadcastLibraryChanged();
    return vaultDirectory();
  });

  // Video-editor session persistence (save on export, load on editor mount).
  registerVideoEditSessionHandlers();
}
