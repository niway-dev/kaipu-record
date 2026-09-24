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
import { ipcMain } from "electron";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { LibraryVault } from "./library-vault";
import { vaultDirectory } from "./vault-location";

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

/**
 * The export stamp already on disk, or null when there is no readable meta sidecar.
 * Best effort by design: a missing or corrupt sidecar means "nothing is known to be
 * exported", which is the safe side — the badge then tells the user to export.
 */
async function readExportedSavedAt(id: string): Promise<number | null> {
  try {
    const raw = await readFile(sessionMetaPath(vaultDirectory().path, id), "utf-8");
    const meta = JSON.parse(raw) as Partial<SessionMeta>;
    return typeof meta.exportedSavedAt === "number" ? meta.exportedSavedAt : null;
  } catch {
    return null;
  }
}

// Exported (not just used via the IPC handlers below) so unit tests can exercise the
// atomic-write/prune/delete behaviour directly against a temp vault dir.
export async function saveSession(id: string, payload: SavePayload): Promise<void> {
  const { sessionJson, assets, exported = false } = payload;

  // Atomic session JSON write (temp + rename so a crash never truncates the file).
  const sp = sessionPath(id);
  await mkdir(metaDir(), { recursive: true });
  const tmp = `${sp}.tmp`;
  await writeFile(tmp, sessionJson, "utf-8");
  await rename(tmp, sp);

  // Write asset files. Create dir even if there are no assets so `assetsDir` always
  // exists (simplifies the prune pass below: readdir won't throw on an empty dir).
  const ad = assetsDir(id);
  await mkdir(ad, { recursive: true });

  const keptIds = new Set(assets.map((a) => a.assetId));

  for (const { assetId, bytes } of assets) {
    await writeFile(assetPath(id, assetId), Buffer.from(bytes));
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
  const sourcePath = await new LibraryVault(vaultDirectory().path).filePath(id);
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
      exportedSavedAt: exported ? savedAt : await readExportedSavedAt(id),
    };
    const mp = sessionMetaPath(vaultDirectory().path, id);
    await writeFile(`${mp}.tmp`, JSON.stringify(meta), "utf-8");
    await rename(`${mp}.tmp`, mp);
  }
}

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

export function registerVideoEditSessionHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.videoEditSaveSession,
    (
      _event,
      id: string,
      sessionJson: string,
      assets: { assetId: string; bytes: ArrayBuffer }[],
      exported?: boolean,
    ) => saveSession(id, { sessionJson, assets, exported }),
  );

  ipcMain.handle(IPC_CHANNELS.videoEditLoadSession, (_event, id: string) => loadSession(id));
}
