/**
 * Main-process handler for video-editor session persistence. Sessions live in the
 * vault's `.kaipu/` sidecar directory, right alongside the existing `.json` metadata
 * and `.jpg` thumbnail sidecars — one JSON file per recording plus one PNG per slide
 * asset. Writes are atomic (temp + rename) so a crash mid-write never corrupts the
 * existing session.
 *
 * Registration: call `registerVideoEditSessionHandlers()` from main/library/index.ts
 * right after `registerLibraryVaultHandlers()` so all library IPC stays in one module.
 */
import { app, ipcMain } from "electron";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  EDIT_PROJECT_CLOUD_ONLY_MARKER,
  EDIT_PROJECT_UNAVAILABLE_MARKER,
} from "@shared/types/library-storage";
import { atomicWriteFile } from "./atomic-write";
import { EvictedFileError } from "./dataless";
import { LibraryVault, SidecarUnavailableError } from "./library-vault";
import { draftKey, readDraft, removeDraft, writeDraft } from "./session-drafts";
import { vaultActivity } from "./vault-activity";
import { vaultDirectory } from "./vault-location";
import { activeWorkspace, workspaceGate } from "../workspaces";
import { ItemMovedError, withItemLock } from "./item-lock";

// ── Path helpers ─────────────────────────────────────────────────────────────

function metaDir(): string {
  return join(vaultDirectory().path, ".kaipu");
}

function sessionPath(id: string): string {
  return join(metaDir(), `${id}.edit.json`);
}

function assetsDir(id: string): string {
  return join(metaDir(), `${id}.assets`);
}

function assetPath(id: string, assetId: string): string {
  return join(assetsDir(id), `${assetId}.png`);
}

/**
 * Path to the session metadata sidecar — the source file's size/mtime plus the
 * asset ids at save time. `edit-project-probe.ts` reads this to decide whether
 * a saved session still matches its source without ever hashing.
 */
export function sessionMetaPath(vaultDir: string, id: string): string {
  return join(vaultDir, ".kaipu", `${id}.edit.meta.json`);
}

export interface SessionMeta {
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  assetIds: string[];
  savedAt: number;
  /**
   * The `savedAt` of the scene that was last burned into an export, or null when no
   * export of this session's content exists.
   *
   * This is the anchor for the library's "not exported" badge, and it is a stamp
   * rather than a timestamp comparison on purpose. The old rule compared an export
   * file's `createdAt` (its birthtime — when the encode *started*) against this
   * session's `savedAt`, but exporting always writes the session immediately
   * afterwards (`video-editor-page.tsx`, the `onSaved` callback), so `savedAt` landed
   * after the export's birthtime every single time and a freshly exported recording
   * always read as "not exported". Equality between two values the same write sets
   * has no such race, and it survives a slow encode of any length.
   */
  exportedSavedAt: number | null;
}

// ── Core logic ────────────────────────────────────────────────────────────────

export interface SavePayload {
  sessionJson: string;
  assets: { assetId: string; bytes: ArrayBuffer }[];
  /**
   * True only for the save that follows a successful export: it stamps
   * `exportedSavedAt` with this write's own `savedAt`, marking this exact scene as
   * burned into a file. Every other save leaves the previous stamp untouched, which
   * is what makes a later edit read as "not exported" again.
   */
  exported?: boolean;
}

export interface LoadResult {
  sessionJson: string;
  assets: { assetId: string; bytes: ArrayBuffer }[];
}

/** The vault a session save reads through: the active workspace's (bounded when it is synced). */
export type SessionVault = () => LibraryVault;

const plainVault: SessionVault = () => new LibraryVault(vaultDirectory().path);

/**
 * The export stamp already on disk: a number, null when nothing is known to be exported (no
 * meta sidecar, or one that is not valid JSON: the safe side, the badge then tells the user to
 * export), "evicted" when the provider has offloaded the file (reading it would download it, which
 * Kaipu never starts), or "unreadable" when it is there but cannot be read now (a provider offline
 * or stalled, EIO). Neither is "never exported", and neither is "unchanged": a save that cannot
 * tell refuses before it writes anything (`ExportStampUnreadableError`), so the session, the
 * assets and the meta never disagree.
 */
async function readExportedSavedAt(
  id: string,
  vault: LibraryVault,
): Promise<number | null | "evicted" | "unreadable"> {
  let raw: string;
  try {
    raw = await vault.readTextBounded(sessionMetaPath(vaultDirectory().path, id));
  } catch (error) {
    if (error instanceof EvictedFileError) return "evicted";
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? null : "unreadable";
  }
  try {
    const meta = JSON.parse(raw) as Partial<SessionMeta>;
    return typeof meta.exportedSavedAt === "number" ? meta.exportedSavedAt : null;
  } catch {
    return null;
  }
}

/**
 * A save was refused before it wrote a byte: the export stamp in the meta file cannot be read now
 * (offloaded by the provider, stalled, unreadable). Writing the session without carrying the stamp
 * forward would make the badge say "exported" for a scene that was edited afterwards, or "never
 * exported" for one that was; leaving the old meta beside a new session would misreport the assets.
 * The editor keeps its pending state, and the edits are also kept as a draft on this computer
 * (`session-drafts.ts`), so closing the window does not lose them.
 *
 * An offloaded file is not "downloading": retrying never fetches it (Kaipu does not start
 * downloads), so the message says where the files are and what to do. Only a provider that
 * does not answer is worth another try.
 */
export class ExportStampUnreadableError extends Error {
  constructor(
    readonly id: string,
    readonly reason: "evicted" | "unreadable" = "unreadable",
  ) {
    super(
      reason === "evicted"
        ? `${EDIT_PROJECT_UNAVAILABLE_MARKER} ${EDIT_PROJECT_CLOUD_ONLY_MARKER}: the edit project of "${id}" was not saved into its folder because the project's files are only in the cloud. Your edits are kept on this computer; open the project again once its files have downloaded.`
        : `${EDIT_PROJECT_UNAVAILABLE_MARKER}: the edit project of "${id}" was not saved into its folder because its export record cannot be read right now (the synced folder is not answering). Your edits are kept on this computer and are saved again on the next edit.`,
    );
    this.name = "ExportStampUnreadableError";
  }
}

// Exported (not just used via the IPC handlers below) so unit tests can exercise the
// atomic-write/prune/delete behaviour directly against a temp vault dir.
export async function saveSession(
  id: string,
  payload: SavePayload,
  makeVault: SessionVault = plainVault,
): Promise<void> {
  const { sessionJson, assets, exported = false } = payload;
  const vault = makeVault();
  // Before any write: an item whose record cannot be read is read-only (F9). Through the
  // workspace's own vault, so a synced folder's read is bounded and never downloads a file.
  await vault.assertWritableRecord(id);

  // The previous export stamp, read BEFORE anything is written: when it cannot be read the whole
  // save is refused, so the session, the assets and the meta are never left out of step (a new
  // session beside an old meta reports the wrong assets, and an old "exported" stamp for a scene
  // edited since). An export's own save carries no previous stamp.
  const previous = exported ? null : await readExportedSavedAt(id, vault);
  if (previous === "unreadable" || previous === "evicted") {
    throw new ExportStampUnreadableError(id, previous);
  }

  // Atomic session JSON write (temp + rename so a crash never truncates the file).
  const sp = sessionPath(id);
  await mkdir(metaDir(), { recursive: true });
  await atomicWriteFile(sp, sessionJson);

  // Write asset files. Create dir even if there are no assets so `assetsDir` always
  // exists (simplifies the prune pass below: readdir won't throw on an empty dir).
  const ad = assetsDir(id);
  await mkdir(ad, { recursive: true });

  const keptIds = new Set(assets.map((a) => a.assetId));

  for (const { assetId, bytes } of assets) {
    // Atomic like the JSON: a provider must not upload a half-written image at its final name.
    await atomicWriteFile(assetPath(id, assetId), Buffer.from(bytes));
  }

  // Prune asset files that were in the previous session but are no longer referenced —
  // avoids accumulating orphaned images when the user removes slides between exports.
  let existing: string[] = [];
  try {
    existing = await readdir(ad);
  } catch {
    // Dir might not exist for the very first save; skip pruning.
  }
  for (const filename of existing) {
    if (!filename.endsWith(".png")) continue;
    const assetId = filename.slice(0, -4); // strip ".png"
    if (!keptIds.has(assetId)) {
      await rm(join(ad, filename), { force: true });
    }
  }

  // Record the source file's size/mtime + the kept asset ids so the editing-state
  // probe can tell a still-fresh session from a stale one without hashing. Best
  // effort: if the source is missing at save time (should not happen from the
  // editor), write nothing — the probe treats a missing meta file as
  // "missing-dependencies".
  const sourcePath = await vault.filePath(id);
  let source: { size: number; mtimeMs: number } | null = null;
  try {
    source = await stat(sourcePath);
  } catch {
    // Source missing at save time — record nothing.
  }
  if (source) {
    // Carry the previous export stamp forward. Dropping it on an ordinary save would
    // make every edit after an export look like it had never been exported at all,
    // collapsing the two states the badge exists to tell apart.
    const savedAt = Date.now();
    const meta: SessionMeta = {
      sourceSizeBytes: source.size,
      sourceMtimeMs: source.mtimeMs,
      assetIds: [...keptIds],
      savedAt,
      exportedSavedAt: exported ? savedAt : previous,
    };
    const mp = sessionMetaPath(vaultDirectory().path, id);
    await atomicWriteFile(mp, JSON.stringify(meta));
  }
}

/**
 * `saveSession` under the item's lock (ADR 0033, decision 12): the JSON, the assets and the
 * prune pass are one critical section against a move of the same item. A save that waited
 * behind a move finds no media here any more and writes nothing (`ItemMovedError`), so it
 * can never recreate source assets or leave a partial project.
 */
export function saveSessionLocked(
  workspaceId: string,
  id: string,
  payload: SavePayload,
  makeVault: SessionVault = plainVault,
  draftsDir: string | null = null,
): Promise<void> {
  return withItemLock(workspaceId, id, async () => {
    const vault = makeVault();
    if (!(await vault.hasMedia(id))) {
      throw new ItemMovedError(id);
    }
    try {
      await saveSession(id, payload, () => vault);
    } catch (error) {
      // The save was refused or failed: the editor keeps its pending edits in memory, and closing
      // its window would drop them. They are kept as a draft on this computer as well. A moved item
      // has no project to keep, and a record that cannot be read makes the item read-only.
      if (
        draftsDir !== null &&
        !(error instanceof ItemMovedError) &&
        !(error instanceof SidecarUnavailableError)
      ) {
        await keepDraft(vault, workspaceId, id, payload, draftsDir);
      }
      throw error;
    }
    // Saved: the draft, if any, is superseded.
    if (draftsDir !== null) {
      await removeDraft(draftsDir, await draftKeyOf(vault, workspaceId, id)).catch(() => {});
    }
  });
}

/** The item's draft key: its asset id from the record when that is readable, else its stem. */
async function draftKeyOf(vault: LibraryVault, workspaceId: string, id: string): Promise<string> {
  let assetId: string | null = null;
  try {
    // Strict and read-only: a malformed record is not quarantined by asking for a draft key.
    const read = await vault.readRecordStrict(vault.sidecarPath(id));
    if (read.status === "ok" && typeof read.sidecar.assetId === "string") {
      assetId = read.sidecar.assetId || null;
    }
  } catch {
    // Unreadable now: the stem still names the item inside this workspace.
  }
  return draftKey(workspaceId, id, assetId);
}

async function keepDraft(
  vault: LibraryVault,
  workspaceId: string,
  id: string,
  payload: SavePayload,
  draftsDir: string,
): Promise<void> {
  try {
    await writeDraft(draftsDir, await draftKeyOf(vault, workspaceId, id), payload);
  } catch (draftError) {
    // The original refusal is what the editor reports; it keeps its pending state either way.
    console.error(`could not keep a draft of the edit project of "${id}"`, draftError);
  }
}

/**
 * `loadSession`, preferring the draft kept for this item when it is newer than the project on
 * disk (a save was refused and the window closed). A draft that is not newer is removed: the
 * project on disk has moved on.
 */
export async function loadSessionRestoringDraft(
  workspaceId: string,
  id: string,
  makeVault: SessionVault,
  draftsDir: string | null,
): Promise<LoadResult | null> {
  if (draftsDir === null) return loadSession(id);
  const key = await draftKeyOf(makeVault(), workspaceId, id);
  const draft = await readDraft(draftsDir, key);
  if (draft === null) return loadSession(id);
  const onDisk = await stat(sessionPath(id)).catch(() => null);
  if (onDisk === null || draft.savedAt > onDisk.mtimeMs) {
    return { sessionJson: draft.sessionJson, assets: draft.assets };
  }
  await removeDraft(draftsDir, key).catch(() => {});
  return loadSession(id);
}

/**
 * Opening the editor is an explicit request for this item (AC13: its edit project must be local
 * before the editor opens), so this read may download the project and its assets from a synced
 * folder, which is what the user asked for. It is not a background read: nothing draws the
 * Library through it. The download cannot be cancelled from here; the cancellable download with
 * progress lands in layer 4 of the synced-workspaces stack.
 */
export async function loadSession(id: string): Promise<LoadResult | null> {
  const sp = sessionPath(id);
  let sessionJson: string;
  try {
    sessionJson = await readFile(sp, "utf-8");
  } catch {
    // No session exists yet — not an error, just a fresh open.
    return null;
  }

  const ad = assetsDir(id);
  let filenames: string[] = [];
  try {
    filenames = await readdir(ad);
  } catch {
    // Assets dir missing is fine — the session might have had no slides.
  }

  const assets: LoadResult["assets"] = [];
  for (const filename of filenames) {
    if (!filename.endsWith(".png")) continue;
    const assetId = filename.slice(0, -4);
    try {
      const buf = await readFile(join(ad, filename));
      // ArrayBuffer slice so the structured-clone over IPC gets a transferable copy
      // rather than a Node Buffer alias (Buffer extends Uint8Array — its underlying
      // ArrayBuffer covers the whole pool, not just this chunk).
      assets.push({
        assetId,
        bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      });
    } catch {
      // Skip unreadable asset files rather than failing the whole load.
    }
  }

  return { sessionJson, assets };
}

/**
 * Delete the session JSON and assets directory for `id`. Called when a recording is
 * deleted so no orphaned `.edit.json` / `.assets/` directory remains in the vault.
 * Best-effort: errors are swallowed so a missing session never blocks a delete.
 */
export async function deleteVideoEditSession(id: string): Promise<void> {
  await Promise.allSettled([
    rm(sessionPath(id), { force: true }),
    rm(assetsDir(id), { recursive: true, force: true }),
    rm(sessionMetaPath(vaultDirectory().path, id), { force: true }),
  ]);
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerVideoEditSessionHandlers(
  makeVault: SessionVault = plainVault,
  draftsDir: string = join(app.getPath("userData"), "video-edit-drafts"),
): void {
  // Item-scoped: stamped with the workspace (ADR 0032). A save that reaches main after a
  // switch is refused, so it can never write the session into the other workspace.
  // Entry points (maintenance mode, NIW2-561): a refused save keeps its pending state in
  // the editor, which retries on `library:maintenance-ended`.
  ipcMain.handle(
    IPC_CHANNELS.videoEditSaveSession,
    (
      _event,
      stamp: unknown,
      id: string,
      sessionJson: string,
      assets: { assetId: string; bytes: ArrayBuffer }[],
      exported?: boolean,
    ) =>
      workspaceGate().run(stamp, () =>
        vaultActivity.run("editor", () =>
          saveSessionLocked(
            activeWorkspace().id,
            id,
            { sessionJson, assets, exported },
            makeVault,
            draftsDir,
          ),
        ),
      ),
  );

  ipcMain.handle(IPC_CHANNELS.videoEditLoadSession, (_event, stamp: unknown, id: string) =>
    workspaceGate().run(stamp, () =>
      vaultActivity.run("editor", () =>
        loadSessionRestoringDraft(activeWorkspace().id, id, makeVault, draftsDir),
      ),
    ),
  );
}
