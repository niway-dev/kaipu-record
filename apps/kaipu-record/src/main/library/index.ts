import { extname, join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeImage, shell, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type { GifSaveMeta, RecordingBackfillMeta, TagSummary } from "@shared/types";
import type { AuthHandle } from "../infrastructure/auth-store";
import { CatalogCache } from "../cloud/catalog-cache";
import { fetchCloudCatalog } from "../cloud/catalog-client";
import { LibraryService } from "./library-service";
import { LibraryVault } from "./library-vault";
import { loadDeviceId, VaultTagRepository, type TagRepository } from "./tag-repository";
import { isTagColor } from "@kaipu/domain/constants";
import { saveGif } from "./gif-save";
import { createDragCopy } from "./drag-copies";
import { friendlyDragName } from "./drag-name";
import { timestampId } from "../recording/recording-writer";
import { activeWorkspace, ownsLegacyCloud, workspaceGate } from "../workspaces";
import { deleteVideoEditSession, registerVideoEditSessionHandlers } from "./video-edit-session";

/** Tell every window the library changed (a new item, a new vault folder) so open pages re-list. */
export function broadcastLibraryChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.libraryChanged);
  }
}

/**
 * A vault bound to the active workspace's folder. Item-scoped handlers call it inside the
 * workspace gate, which holds a switch off until they finish, so one call sees one folder.
 */
export function currentVault(): LibraryVault {
  const active = activeWorkspace();
  return new LibraryVault(active.path, active.id);
}

/** The active workspace's folder. */
function vaultPath(): string {
  return activeWorkspace().path;
}

/**
 * An item-scoped IPC handler: the preload sends the workspace stamp first, and the call
 * runs only when it names the active workspace and generation (ADR 0032, decision 6).
 */
export function scoped<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
): (event: IpcMainInvokeEvent, stamp: unknown, ...args: A) => Promise<R> {
  return (_event, stamp, ...args) => workspaceGate().run(stamp, () => fn(...args));
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
  return join(vaultPath(), ".kaipu", `${id}.jpg`);
}

export function registerLibraryVaultHandlers(deps: { auth: AuthHandle; serverUrl: string }): void {
  const service = new LibraryService({
    vault: currentVault,
    vaultDir: vaultPath,
    ownsLegacyCloud,
    cache: new CatalogCache(app.getPath("userData")),
    account: deps.auth.getCurrentAccount,
    fetchCatalog: (token) => fetchCloudCatalog({ serverUrl: deps.serverUrl }, token),
  });

  ipcMain.handle(
    IPC_CHANNELS.listLibraryItems,
    scoped(() => service.list()),
  );
  ipcMain.handle(IPC_CHANNELS.refreshCloudCatalog, async () => {
    const result = await service.refreshCatalog();
    if (result.ok) broadcastLibraryChanged();
    return result;
  });
  ipcMain.handle(
    IPC_CHANNELS.removeLocalCopy,
    scoped(async (id: string) => {
      const result = await service.removeLocalCopy(id);
      if (result.ok) broadcastLibraryChanged();
      return result;
    }),
  );
  // Account changes (sign-in, sign-out, switch) re-list so the previous account's cloud
  // items disappear at once, and kick a refresh for the new one.
  deps.auth.onAccountChanged((userId) => {
    broadcastLibraryChanged();
    if (userId) void service.refreshCatalog().then((r) => r.ok && broadcastLibraryChanged());
  });

  ipcMain.handle(
    IPC_CHANNELS.listLocalRecordings,
    scoped(() => currentVault().list()),
  );
  ipcMain.handle(
    IPC_CHANNELS.loadCursorTrack,
    scoped((id: string) => currentVault().readCursorTrack(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.renameLocalRecording,
    scoped((id: string, title: string) => currentVault().rename(id, title)),
  );
  // No broadcast: the stamp only reorders the Editor home, which re-lists on mount.
  ipcMain.handle(
    IPC_CHANNELS.markOpenedInEditor,
    scoped((id: string) => currentVault().markOpenedInEditor(id)),
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
  // The tag registry is read and then written with awaits between: the gate keeps a switch
  // out of that window, so a write never lands in another workspace's tags.json.
  ipcMain.handle(
    IPC_CHANNELS.listTags,
    scoped(() => tags.list()),
  );
  ipcMain.handle(
    IPC_CHANNELS.createTag,
    scoped(async (name: unknown, color: unknown) =>
      summary((await changed(tags.create(String(name), isTagColor(color) ? color : undefined))).id),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.renameTag,
    scoped(async (id: unknown, name: unknown) =>
      summary((await changed(tags.rename(String(id), String(name)))).id),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.recolorTag,
    scoped(async (id: unknown, color: unknown) => {
      if (!isTagColor(color)) throw new Error("tags: not a palette color");
      return summary((await changed(tags.recolor(String(id), color))).id);
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.deleteTag,
    scoped((id: unknown) => changed(tags.remove(String(id)))),
  );
  ipcMain.handle(
    IPC_CHANNELS.setItemTags,
    scoped((itemId: unknown, tagIds: unknown) =>
      changed(
        tags.assign(
          String(itemId),
          Array.isArray(tagIds) ? tagIds.filter((t): t is string => typeof t === "string") : [],
        ),
      ),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.backfillLocalRecordingMeta,
    scoped((id: string, meta: RecordingBackfillMeta) => currentVault().backfill(id, meta)),
  );
  ipcMain.handle(
    IPC_CHANNELS.deleteLocalRecording,
    scoped(async (id: string) => {
      await currentVault().remove(id);
      // Best-effort: a missing session must never block the delete.
      await deleteVideoEditSession(id).catch(() => {});
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.revealLocalRecording,
    scoped(async (id: string) => shell.showItemInFolder(await currentVault().filePath(id))),
  );
  // NIW2-217: GIF export. Bytes are validated (GIF89a, ≤ 64 MB) and the path is chosen here.
  ipcMain.handle(
    IPC_CHANNELS.gifSave,
    scoped(async (bytes: ArrayBuffer, meta: GifSaveMeta) => {
      const recording = await saveGif(
        { vaultDir: vaultPath, newId: () => timestampId(Date.now()) },
        bytes,
        meta,
      );
      broadcastLibraryChanged();
      return recording;
    }),
  );
  // NIW2-217: drag a vault file out (e.g. a GIF into Slack or a GitHub comment). The id is
  // resolved inside the vault — the renderer never names a path.
  // NIW2-218: when the renderer sends the item's title, the dragged file carries it instead of
  // the vault id. The vault keeps its id name; the friendly file is a hard link (no extra
  // space) in `<vault>/.kaipu/drag/` (same volume), pruned when older than an hour and wiped
  // on quit.
  ipcMain.on(IPC_CHANNELS.startFileDrag, (event, stamp: unknown, id: string, name?: unknown) => {
    void workspaceGate()
      .run(stamp, async () => {
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
      })
      .catch((error) => console.error("file drag failed", error));
  });

  // Video-editor session persistence (save on export, load on editor mount).
  registerVideoEditSessionHandlers();
}
