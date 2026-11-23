import { lstat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { IPC_CHANNELS } from "@shared/types";
import type {
  GifSaveMeta,
  ReconcileFixResult,
  RecordingBackfillMeta,
  RenameResult,
  TagSummary,
} from "@shared/types";
import { IMPORTABLE_VIDEO_EXTENSIONS, type ImportVideoResult } from "@shared/import-video";
import { createMainTranslator } from "@kaipu/i18n/main";
import { getAppSettings } from "../infrastructure/settings-store";
import type { AuthHandle } from "../infrastructure/auth-store";
import { CatalogCache } from "../cloud/catalog-cache";
import { fetchCloudCatalog } from "../cloud/catalog-client";
import { EditorSessions } from "./editor-sessions";
import { LibraryService } from "./library-service";
import { LibraryVault, isPlainItemId } from "./library-vault";
import { loadDeviceId, VaultTagRepository, type TagRepository } from "./tag-repository";
import { isTagColor } from "@kaipu/domain/constants";
import { saveGif } from "./gif-save";
import { importVideoFiles, type ImportVideoDeps } from "./import-video";
import { createDragCopy, dragRoot } from "./drag-copies";
import { dragLedger } from "./drag-ledger";
import { withItemLock } from "./item-lock";
import { friendlyDragName } from "./drag-name";
import {
  activeEvictionProbe,
  activeScratch,
  activeWorkspace,
  ownsLegacyCloud,
  workspaceGate,
} from "../workspaces";
import { registerVideoEditSessionHandlers } from "./video-edit-session";
import { MaintenanceError, vaultActivity, type ActivityKind } from "./vault-activity";
import { skipPaths } from "./vault-reconcile";

/** A JPEG starts with FFD8FF; the renderer composites it, so main checks before it lands on disk. */
function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args);
  }
}

/** Tell every window the library changed (a new item, a new vault folder) so open pages re-list. */
export function broadcastLibraryChanged(): void {
  broadcast(IPC_CHANNELS.libraryChanged);
}

/**
 * A vault bound to the active workspace's folder. Item-scoped handlers call it inside the
 * workspace gate, which holds a switch off until they finish, so one call sees one folder.
 */
export function currentVault(): LibraryVault {
  const active = activeWorkspace();
  // A synced workspace asks which files are evicted, so no URL it hands out downloads one.
  return new LibraryVault(active.path, active.id, undefined, activeEvictionProbe());
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

/**
 * An item-scoped handler that also enters the vault: the workspace gate binds it to the
 * active workspace and holds a switch off until it ends (ADR 0032), and inside it one
 * activity lease refuses it while "Check and fix files" runs (NIW2-561).
 */
export function scopedAdmitted<A extends unknown[], R>(
  kind: ActivityKind,
  fn: (...args: A) => R,
): (event: IpcMainInvokeEvent, stamp: unknown, ...args: A) => Promise<Awaited<R>> {
  return scoped((...args: A) =>
    vaultActivity.run(kind, async (): Promise<Awaited<R>> => await fn(...args)),
  );
}

/**
 * NIW2-669: the file of a local item in the current vault, or null when the id is not a plain
 * item id or no file exists for it. `filePath` alone returns a non-existent `.mp4` path for an
 * unknown id, so the existence check is what makes "unknown" come back as null.
 */
async function localRecordingFile(id: string): Promise<string | null> {
  if (!isPlainItemId(id)) return null;
  const file = await currentVault().filePath(id);
  // lstat, not stat: a symlink named like an item must not hand its target to the OS, and a
  // directory is not a recording.
  return lstat(file).then(
    (info) => (info.isFile() ? file : null),
    () => null,
  );
}

/** Absolute path to a recording's real video file in the current vault. */
export async function recordingFilePath(id: string): Promise<string> {
  return currentVault().filePath(id);
}

export async function screenshotFilePath(id: string): Promise<string> {
  return currentVault().filePath(id); // resolves <id>.png
}

/** Absolute path to a recording's webcam track (may not exist; ADR 0037). */
export function webcamFilePath(id: string): string {
  return currentVault().webcamFilePath(id);
}

/** Absolute path to a recording's thumbnail jpg (may not exist). */
export function thumbnailFilePath(id: string): string {
  return join(vaultPath(), ".kaipu", `${id}.jpg`);
}

export function registerLibraryVaultHandlers(deps: {
  auth: AuthHandle;
  serverUrl: string;
  /** True while a video export is encoding: a rename then keeps the file's name ("busy"). */
  isExportActive: () => boolean;
}): void {
  const service = new LibraryService({
    vault: currentVault,
    vaultDir: vaultPath,
    ownsLegacyCloud,
    cache: new CatalogCache(app.getPath("userData")),
    account: deps.auth.getCurrentAccount,
    fetchCatalog: (token) => fetchCloudCatalog({ serverUrl: deps.serverUrl }, token),
    reveal: (path) => shell.showItemInFolder(path),
  });

  ipcMain.handle(
    IPC_CHANNELS.listLibraryItems,
    scopedAdmitted("library", () => service.list()),
  );
  // The cloud is optional: this never rejects (the service folds every failure into a
  // result). Only a catalog that really differs re-lists the Library in every window.
  ipcMain.handle(IPC_CHANNELS.refreshCloudCatalog, async (_event, force?: unknown) => {
    const result = await service.refreshCatalog({ force: force === true });
    if (result.ok && result.changed) broadcastLibraryChanged();
    return result;
  });
  // One lease around describe → hash → delete.
  ipcMain.handle(
    IPC_CHANNELS.removeLocalCopy,
    scopedAdmitted("library", async (id: string) => {
      const result = await service.removeLocalCopy(id);
      if (result.ok) broadcastLibraryChanged();
      return result;
    }),
  );
  // Account changes (sign-in, sign-out, switch) re-list so the previous account's cloud
  // items disappear at once, and kick a refresh for the new one.
  deps.auth.onAccountChanged((userId) => {
    broadcastLibraryChanged();
    if (userId) {
      // A new account must not wait out the throttle of the previous one.
      void service
        .refreshCatalog({ force: true })
        .then((r) => r.ok && r.changed && broadcastLibraryChanged());
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.listLocalRecordings,
    scopedAdmitted("library", () => currentVault().list()),
  );
  ipcMain.handle(
    IPC_CHANNELS.loadCursorTrack,
    scopedAdmitted("library", (id: string) => currentVault().readCursorTrack(id)),
  );
  // NIW2-560: the video editor holds its source id for its lifetime. Whatever asks for a
  // rename (a toast's Retry survives navigation), the file keeps its name while the item
  // is open there. A window that is destroyed, crashes or reloads releases what it held.
  const editorSessions = new EditorSessions();
  // Serialized with renames (names lock): an editor that opens while a rename is moving
  // the file waits, and loads under the id the rename produced. Item-scoped: it runs
  // inside the workspace gate like every other vault call, so a switch waits for it.
  ipcMain.handle(IPC_CHANNELS.editorSessionAcquire, (event, stamp: unknown, assetId: unknown) =>
    workspaceGate().run(stamp, () =>
      vaultActivity.run("editor", async () => {
        if (typeof assetId !== "string") return null;
        const sender = event.sender;
        const owner = sender.id;
        editorSessions.watch(sender);
        // Captured on arrival: if the window reloads or closes while the request waits for
        // the names lock, the hold is refused instead of outliving the page that asked.
        const generation = editorSessions.generation(owner);
        return currentVault().acquireForEditor(
          assetId,
          (id) =>
            !sender.isDestroyed() && editorSessions.openIfCurrent(owner, generation, id, assetId),
        );
      }),
    ),
  );
  ipcMain.on(IPC_CHANNELS.editorSessionClose, (event, id: unknown) => {
    if (typeof id === "string") editorSessions.close(event.sender.id, id);
  });

  // NIW2-561: "Check and fix files". The scan is read-only; Fix all runs in maintenance
  // mode, and while it waits for the vault to be idle the dialog may cancel it.
  // Both run inside the workspace gate: a switch waits for a scan or a fix to finish, so
  // neither sees two folders, and a stale window's request is refused.
  ipcMain.handle(
    IPC_CHANNELS.libraryReconcileScan,
    scoped(() => service.reconcileScan()),
  );
  let reconcileWait: AbortController | null = null;
  ipcMain.handle(
    IPC_CHANNELS.libraryReconcileFix,
    scoped(async (skip?: unknown): Promise<ReconcileFixResult> => {
      // A second call (another window, a double trigger) must not take the running run's cancel
      // handle: it is answered here and leaves the slot alone.
      if (reconcileWait) return { status: "already-running" };
      const wait = new AbortController();
      reconcileWait = wait;
      try {
        const result = await service.reconcileFix({
          signal: wait.signal,
          onProgress: (progress) => broadcast(IPC_CHANNELS.libraryReconcileProgress, progress),
          isEditing: (id, assetId) => editorSessions.isOpen(id, assetId),
          skip: skipPaths(skip),
        });
        if (result.status === "done") broadcastLibraryChanged();
        return result;
      } finally {
        if (reconcileWait === wait) reconcileWait = null;
      }
    }),
  );
  // Only stops the wait: once files are being fixed, the run finishes.
  ipcMain.handle(IPC_CHANNELS.libraryReconcileCancel, () => reconcileWait?.abort());
  vaultActivity.onMaintenanceEnded(() => broadcast(IPC_CHANNELS.libraryMaintenanceEnded));

  // NIW2-560: the file follows the title. An export streams its source over the media
  // protocol for minutes, so while one runs the file keeps its name (the title is saved).
  ipcMain.handle(
    IPC_CHANNELS.renameLocalRecording,
    scopedAdmitted(
      "library",
      async (id: unknown, assetId: unknown, title: unknown): Promise<RenameResult> => {
        if (typeof id !== "string" || !isPlainItemId(id)) throw new Error("rename: invalid id");
        // Never a bare id: the item is resolved by identity under the names lock.
        if (typeof assetId !== "string" || assetId.length === 0) {
          throw new Error("rename: invalid assetId");
        }
        if (typeof title !== "string") throw new Error("rename: invalid title");
        // Under the item lock: a rename never interleaves with a move of the same item.
        const result = await withItemLock(activeWorkspace().id, id, () =>
          currentVault().renameItem({ id, assetId }, title.trim(), {
            isBusy: deps.isExportActive,
            isEditing: (itemId, assetId) => editorSessions.isOpen(itemId, assetId),
          }),
        );
        if (result.file === "renamed") broadcastLibraryChanged();
        return result;
      },
    ),
  );
  // No broadcast: the stamp only reorders the Editor home, which re-lists on mount.
  ipcMain.handle(
    IPC_CHANNELS.markOpenedInEditor,
    scopedAdmitted("library", (id: string) => currentVault().markOpenedInEditor(id)),
  );
  // Every vault handler below enters under one lease (maintenance mode).
  const handleVault = <A extends unknown[]>(channel: string, fn: (...args: A) => unknown): void =>
    ipcMain.handle(channel, scopedAdmitted("library", fn));
  // Tags (ADR 0020). Every change re-lists the Library in every window, so cards,
  // filters and the drawer never disagree about a tag's name or color.
  let deviceId = "unknown";
  void loadDeviceId(app.getPath("userData")).then((id) => (deviceId = id));
  const tags: TagRepository = new VaultTagRepository(currentVault, () => deviceId);
  // A brand-new tag carries no item yet, so its summary needs no counting scan of the vault.
  const fresh = (tag: Omit<TagSummary, "count">): TagSummary => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    color: tag.color,
    count: 0,
  });
  const changed = async <T>(work: Promise<T>): Promise<T> => {
    const result = await work;
    broadcastLibraryChanged();
    return result;
  };
  // The tag registry is read and then written with awaits between: the gate keeps a switch
  // out of that window, so a write never lands in another workspace's tags.json.
  handleVault(IPC_CHANNELS.listTags, () => tags.list());
  handleVault(IPC_CHANNELS.createTag, async (name: unknown, color: unknown) =>
    fresh(await changed(tags.create(String(name), isTagColor(color) ? color : undefined))),
  );
  // Rename and recolor answer nothing: the broadcast re-lists every window's tags.
  handleVault(IPC_CHANNELS.renameTag, async (id: unknown, name: unknown) => {
    await changed(tags.rename(String(id), String(name)));
  });
  handleVault(IPC_CHANNELS.recolorTag, async (id: unknown, color: unknown) => {
    if (!isTagColor(color)) throw new Error("tags: not a palette color");
    await changed(tags.recolor(String(id), color));
  });
  handleVault(IPC_CHANNELS.deleteTag, (id: unknown) => changed(tags.remove(String(id))));
  handleVault(IPC_CHANNELS.setItemTags, (itemId: unknown, tagIds: unknown) =>
    changed(
      tags.assign(
        String(itemId),
        Array.isArray(tagIds) ? tagIds.filter((t): t is string => typeof t === "string") : [],
      ),
    ),
  );
  handleVault(IPC_CHANNELS.backfillLocalRecordingMeta, (id: string, meta: RecordingBackfillMeta) =>
    currentVault().backfill(id, meta),
  );
  // NIW2-845: the Library composites the webcam bubble into the poster; main validates the
  // bytes as a JPEG and writes them with the marker. A non-webcam item is refused (null).
  handleVault(IPC_CHANNELS.writeWebcamThumbnail, (id: string, assetId: unknown, jpeg: unknown) => {
    if (typeof assetId !== "string" || !assetId) throw new Error("webcam thumbnail: no asset id");
    const bytes = jpeg instanceof ArrayBuffer ? Buffer.from(jpeg) : null;
    if (!bytes || !isJpeg(bytes)) throw new Error("webcam thumbnail: not a JPEG");
    return currentVault().writeWebcamThumbnail(id, assetId, bytes);
  });
  // remove() deletes every companion, the edit session and its assets included.
  handleVault(IPC_CHANNELS.deleteLocalRecording, (id: string) =>
    withItemLock(activeWorkspace().id, id, () => currentVault().remove(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.revealLocalRecording,
    scoped(async (id: string) => shell.showItemInFolder(await currentVault().filePath(id))),
  );
  // NIW2-669: open a local recording in its default app, and give the renderer its path. Both
  // resolve the id inside the vault (the renderer never names a path) and go through
  // handleVault, so maintenance mode refuses them: openPath launches the file itself.
  handleVault(IPC_CHANNELS.openLocalRecording, async (id: string) => {
    const file = await localRecordingFile(id);
    if (!file) throw new Error("open: no local recording for this id");
    // An evicted file opens by downloading it; Kaipu never starts that itself (ADR 0069).
    await currentVault().assertLocal([file]);
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
  });
  handleVault(IPC_CHANNELS.localRecordingPath, (id: string) => localRecordingFile(id));
  // NIW2-217: GIF export. Bytes are validated (GIF89a, ≤ 64 MB) and the path is chosen here.
  handleVault(IPC_CHANNELS.gifSave, async (bytes: ArrayBuffer, meta: GifSaveMeta) => {
    const recording = await saveGif({ vaultDir: vaultPath }, bytes, meta);
    broadcastLibraryChanged();
    return recording;
  });
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
        // A synced workspace (decision 15): an evicted file cannot be dragged (a copy would
        // download it), and the drag copy is a real copy in userData, never a hard link.
        const scratch = activeScratch();
        const probe = activeEvictionProbe();
        const poster = vault.thumbnailPath(id);
        // The poster is read for the drag icon, so an offloaded one stops the drag too.
        if (probe) {
          const offloaded = await probe([file, poster]);
          if (offloaded.has(file) || offloaded.has(poster)) return;
        }
        // macOS refuses a drag without an icon; the poster is there for videos and GIFs.
        const icon = nativeImage.createFromPath(poster);
        if (icon.isEmpty()) return;
        const root = scratch ? join(scratch, "drag") : dragRoot(vault.directory);
        const dragFile =
          typeof name === "string" && name.length > 0
            ? await createDragCopy(
                vault.directory,
                file,
                friendlyDragName(name, extname(file)),
                undefined,
                { root, synced: scratch !== null },
              )
            : file;
        // A move of this item waits 10 s after a drag, and removes its drag folder (ADR 0033).
        const workspaceId = activeWorkspace().id;
        const inDragRoot = dragFile.startsWith(root);
        dragLedger.record({ workspaceId, itemId: id, dir: inDragRoot ? dirname(dragFile) : null });
        event.sender.startDrag({ file: dragFile, icon: icon.resize({ width: 96 }) });
      })
      .catch((error) => console.error("file drag failed", error));
  });

  // NIW2-579: bring outside videos into the vault. Main validates and copies; the renderer
  // only ever names paths (from the dialog here, or from a drop), never writes. Each import
  // runs inside the workspace gate and under one vault lease, like every other vault write.
  const importDeps: ImportVideoDeps = {
    vaultDir: vaultPath,
    newId: (now) => importedId(now),
  };
  const importAndBroadcast = async (stamp: unknown, paths: unknown): Promise<ImportVideoResult> =>
    workspaceGate().run(stamp, () =>
      vaultActivity.run("library", async () => {
        const result = await importVideoFiles(paths, importDeps);
        if (result.imported.length > 0) broadcastLibraryChanged();
        return result;
      }),
    );
  ipcMain.handle(
    IPC_CHANNELS.importVideos,
    async (event, stamp: unknown): Promise<ImportVideoResult> => {
      // Refused before the dialog while "Check and fix files" runs, rather than after the
      // user picked files.
      if (vaultActivity.inMaintenance) throw new MaintenanceError();
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
      // The dialog stays outside the gate: a workspace switch must not wait on the user.
      const picked = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (picked.canceled || picked.filePaths.length === 0) {
        return { imported: [], failed: [], canceled: true };
      }
      return importAndBroadcast(stamp, picked.filePaths);
    },
  );
  ipcMain.handle(IPC_CHANNELS.importVideoFiles, (_event, stamp: unknown, paths: unknown) =>
    importAndBroadcast(stamp, paths),
  );

  // Video-editor session persistence (save on export, load on editor mount).
  registerVideoEditSessionHandlers();
}

/** An imported item's id: `imported-2026-10-31-13-51-00`, the stamp of when it came in. */
function importedId(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  return `imported-${iso}`;
}
