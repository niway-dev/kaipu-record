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
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
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

// ── Core logic ────────────────────────────────────────────────────────────────

export interface SavePayload {
  sessionJson: string;
  assets: { assetId: string; bytes: ArrayBuffer }[];
}

export interface LoadResult {
  sessionJson: string;
  assets: { assetId: string; bytes: ArrayBuffer }[];
}

// Exported (not just used via the IPC handlers below) so unit tests can exercise the
// atomic-write/prune/delete behaviour directly against a temp vault dir.
export async function saveSession(id: string, payload: SavePayload): Promise<void> {
  const { sessionJson, assets } = payload;

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
  ]);
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerVideoEditSessionHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.videoEditSaveSession,
    (_event, id: string, sessionJson: string, assets: { assetId: string; bytes: ArrayBuffer }[]) =>
      saveSession(id, { sessionJson, assets }),
  );

  ipcMain.handle(IPC_CHANNELS.videoEditLoadSession, (_event, id: string) => loadSession(id));
}
