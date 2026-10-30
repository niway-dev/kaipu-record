import { extname, join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type { GifSaveMeta, RecordingBackfillMeta, TagSummary, VaultDirectory } from "@shared/types";
import { IMPORTABLE_VIDEO_EXTENSIONS, type ImportVideoResult } from "@shared/import-video";
import { createMainTranslator } from "@kaipu/i18n/main";
import type { AuthHandle } from "../infrastructure/auth-store";
import { getAppSettings } from "../infrastructure/settings-store";
import { CatalogCache } from "../cloud/catalog-cache";
import { fetchCloudCatalog } from "../cloud/catalog-client";
import { LibraryService } from "./library-service";
import { LibraryVault } from "./library-vault";
import { loadDeviceId, VaultTagRepository, type TagRepository } from "./tag-repository";
import { isTagColor } from "@kaipu/domain/constants";
import { saveGif } from "./gif-save";
import { importVideoFiles, type ImportVideoDeps } from "./import-video";
import { createDragCopy } from "./drag-copies";
import { friendlyDragName } from "./drag-name";
import { timestampId } from "../recording/recording-writer";
import { resetVaultDirectory, setVaultDirectory, vaultDirectory } from "./vault-location";
import { deleteVideoEditSession, registerVideoEditSessionHandlers } from "./video-edit-session";

/** Tell every window the library changed (a new item, a new vault folder) so open pages re-list. */
export function broadcastLibraryChanged(): void {
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

export function registerLibraryVaultHandlers(deps: { auth: AuthHandle; serverUrl: string }): void {
  const service = new LibraryService({
    vault: currentVault,
    vaultDir: () => vaultDirectory().path,
    cache: new CatalogCache(app.getPath("userData")),
    account: deps.auth.getCurrentAccount,
    fetchCatalog: (token) => fetchCloudCatalog({ serverUrl: deps.serverUrl }, token),
  });

  ipcMain.handle(IPC_CHANNELS.listLibraryItems, () => service.list());
  ipcMain.handle(IPC_CHANNELS.refreshCloudCatalog, async () => {
    const result = await service.refreshCatalog();
    if (result.ok) broadcastLibraryChanged();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.removeLocalCopy, async (_event, id: string) => {
    const result = await service.removeLocalCopy(id);
    if (result.ok) broadcastLibraryChanged();
    return result;
  });
  // Account changes (sign-in, sign-out, switch) re-list so the previous account's cloud
  // items disappear at once, and kick a refresh for the new one.
  deps.auth.onAccountChanged((userId) => {
    broadcastLibraryChanged();
    if (userId) void service.refreshCatalog().then((r) => r.ok && broadcastLibraryChanged());
  });

  ipcMain.handle(IPC_CHANNELS.listLocalRecordings, () => currentVault().list());
  ipcMain.handle(IPC_CHANNELS.loadCursorTrack, (_event, id: string) =>
    currentVault().readCursorTrack(id),
  );
  ipcMain.handle(IPC_CHANNELS.renameLocalRecording, (_event, id: string, title: string) =>
    currentVault().rename(id, title),
  );
  // No broadcast: the stamp only reorders the Editor home, which re-lists on mount.
  ipcMain.handle(IPC_CHANNELS.markOpenedInEditor, (_event, id: string) =>
    currentVault().markOpenedInEditor(id),
  );
  // Tags (ADR 0020). Every change re-lists the Library in every window, so cards,
  // filters and the drawer never disagree about a tag's name or color.
  let deviceId = "unknown";
  void loadDeviceId(app.getPath("userData")).then((id) => (deviceId = id));
  const tags: TagRepository = new VaultTagRepository(currentVault, () => deviceId);
  const summary = async (id: string): Promise<TagSummary> =>
    (await tags.list()).find((t) => t.id === id)!;
  const changed = async <T>(work: Promise<T>): Promise<T> => {
    const result = await work;
    broadcastLibraryChanged();
    return result;
  };
  ipcMain.handle(IPC_CHANNELS.listTags, () => tags.list());
  ipcMain.handle(IPC_CHANNELS.createTag, async (_event, name: unknown, color: unknown) =>
    summary((await changed(tags.create(String(name), isTagColor(color) ? color : undefined))).id),
  );
  ipcMain.handle(IPC_CHANNELS.renameTag, async (_event, id: unknown, name: unknown) =>
    summary((await changed(tags.rename(String(id), String(name)))).id),
  );
  ipcMain.handle(IPC_CHANNELS.recolorTag, async (_event, id: unknown, color: unknown) => {
    if (!isTagColor(color)) throw new Error("tags: not a palette color");
    return summary((await changed(tags.recolor(String(id), color))).id);
  });
  ipcMain.handle(IPC_CHANNELS.deleteTag, (_event, id: unknown) => changed(tags.remove(String(id))));
  ipcMain.handle(IPC_CHANNELS.setItemTags, (_event, itemId: unknown, tagIds: unknown) =>
    changed(
      tags.assign(
        String(itemId),
        Array.isArray(tagIds) ? tagIds.filter((t): t is string => typeof t === "string") : [],
      ),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.backfillLocalRecordingMeta,
    (_event, id: string, meta: RecordingBackfillMeta) => currentVault().backfill(id, meta),
  );
  ipcMain.handle(IPC_CHANNELS.deleteLocalRecording, async (_event, id: string) => {
    await currentVault().remove(id);
    // Best-effort: a missing session must never block the delete.
    await deleteVideoEditSession(id).catch(() => {});
  });
  ipcMain.handle(IPC_CHANNELS.revealLocalRecording, async (_event, id: string) =>
    shell.showItemInFolder(await currentVault().filePath(id)),
  );
  // NIW2-217: GIF export. Bytes are validated (GIF89a, ≤ 64 MB) and the path is chosen here.
  ipcMain.handle(IPC_CHANNELS.gifSave, async (_event, bytes: ArrayBuffer, meta: GifSaveMeta) => {
    const recording = await saveGif(
      { vaultDir: () => vaultDirectory().path, newId: () => timestampId(Date.now()) },
      bytes,
      meta,
    );
    broadcastLibraryChanged();
    return recording;
  });
  // NIW2-217: drag a vault file out (e.g. a GIF into Slack or a GitHub comment). The id is
  // resolved inside the vault — the renderer never names a path.
  // NIW2-218: when the renderer sends the item's title, the dragged file carries it instead of
  // the vault id. The vault keeps its id name; the friendly file is a hard link (no extra
  // space) in `<vault>/.kaipu/drag/` (same volume), pruned when older than an hour and wiped
  // on quit.
  ipcMain.on(IPC_CHANNELS.startFileDrag, (event, id: string, name?: unknown) => {
    void (async () => {
      if (typeof id !== "string" || /[\\/]|\.\./.test(id)) return;
      const vault = currentVault();
      const file = await vault.filePath(id);
      // macOS refuses a drag without an icon; the poster is there for videos and GIFs.
      const icon = nativeImage.createFromPath(vault.thumbnailPath(id));
      if (icon.isEmpty()) return;
      const dragFile =
        typeof name === "string" && name.length > 0
          ? await createDragCopy(vault.directory, file, friendlyDragName(name, extname(file)))
          : file;
      event.sender.startDrag({ file: dragFile, icon: icon.resize({ width: 96 }) });
    })().catch((error) => console.error("file drag failed", error));
  });

  // NIW2-579: bring outside videos into the vault. Main validates and copies; the renderer
  // only ever names paths (from the dialog here, or from a drop), never writes.
  const importDeps: ImportVideoDeps = {
    vaultDir: () => vaultDirectory().path,
    newId: (now) => timestampId(now).replace(/^recording-/, "imported-"),
  };
  const importAndBroadcast = async (paths: unknown): Promise<ImportVideoResult> => {
    const result = await importVideoFiles(paths, importDeps);
    if (result.imported.length > 0) broadcastLibraryChanged();
    return result;
  };
  ipcMain.handle(IPC_CHANNELS.importVideos, async (event): Promise<ImportVideoResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const t = createMainTranslator(getAppSettings().locale);
    const options: Electron.OpenDialogOptions = {
      title: t("dialogs.importVideoTitle"),
      buttonLabel: t("dialogs.importVideoButton"),
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: t("dialogs.importVideoFileType"),
          extensions: IMPORTABLE_VIDEO_EXTENSIONS.map((ext) => ext.slice(1)),
        },
      ],
    };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) {
      return { imported: [], failed: [], canceled: true };
    }
    return importAndBroadcast(picked.filePaths);
  });
  ipcMain.handle(IPC_CHANNELS.importVideoFiles, (_event, paths: unknown) =>
    importAndBroadcast(paths),
  );

  ipcMain.handle(IPC_CHANNELS.getVaultDirectory, (): VaultDirectory => vaultDirectory());
  // shell.openPath resolves with an error string ("" on success) rather than rejecting.
  ipcMain.handle(IPC_CHANNELS.openVaultDirectory, async (): Promise<void> => {
    const { path } = vaultDirectory();
    await mkdir(path, { recursive: true });
    const error = await shell.openPath(path);
    if (error) console.error("failed to open the recordings folder", error);
  });

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
