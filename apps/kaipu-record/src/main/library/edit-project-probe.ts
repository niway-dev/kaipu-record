/**
 * The editing axis for one library item — whether an editor session can be
 * opened for a local recording, and whether it is still safe to open.
 * Deliberately cheap: `stat`/existence checks only, no hashing — `list()` calls
 * this for every item, and hashing is lazy elsewhere (`LibraryVault.ensureContentHash`).
 */
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EditingState } from "@shared/types/library-item";
import { sessionMetaPath, type SessionMeta } from "./video-edit-session";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function hasEditSession(vaultDir: string, id: string): Promise<boolean> {
  return exists(join(vaultDir, ".kaipu", `${id}.edit.json`));
}

/**
 * The editing axis for one local item. `local` is the item's local-copy view
 * (or `null` when there is no local file). Never hashes: a session is
 * considered fresh when the source's size + mtime still match what was
 * recorded at save time and every referenced asset file still exists.
 */
export async function probeEditing(
  vaultDir: string,
  local: { id: string; filePath: string; derivedFromAssetId: string | null } | null,
): Promise<EditingState> {
  if (!local) return "needs-source";
  if (!(await hasEditSession(vaultDir, local.id))) {
    return local.derivedFromAssetId ? "exported-only" : "project-available";
  }
  const metaPath = sessionMetaPath(vaultDir, local.id);
  if (!(await exists(metaPath))) {
    // A session saved before this branch has `.edit.json` but no `.edit.meta.json` —
    // there is nothing to compare the source against, so trust the session rather
    // than reporting a false "missing-dependencies" for every pre-existing project.
    return "project-available";
  }
  let meta: SessionMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf-8")) as SessionMeta;
  } catch {
    // Present but unreadable/corrupt: unlike the absent case above, this is a real
    // problem with a file that should exist and be trustworthy.
    return "missing-dependencies";
  }
  let info;
  try {
    info = await stat(local.filePath);
  } catch {
    return "needs-source";
  }
  if (info.size !== meta.sourceSizeBytes || info.mtimeMs !== meta.sourceMtimeMs)
    return "missing-dependencies";
  for (const assetId of meta.assetIds) {
    if (!(await exists(join(vaultDir, ".kaipu", `${local.id}.assets`, `${assetId}.png`)))) {
      return "missing-dependencies";
    }
  }
  return "project-available";
}

/**
 * When the edit session was last written (epoch ms), or null when the item has no
 * session, no meta sidecar, or an unreadable one. Read-only, like `probeEditing`:
 * the library badge compares this against the item's exports' `createdAt`.
 */
export async function probeEditSavedAt(vaultDir: string, id: string): Promise<number | null> {
  if (!(await hasEditSession(vaultDir, id))) return null;
  try {
    const meta = JSON.parse(await readFile(sessionMetaPath(vaultDir, id), "utf-8")) as SessionMeta;
    return typeof meta.savedAt === "number" ? meta.savedAt : null;
  } catch {
    return null;
  }
}
