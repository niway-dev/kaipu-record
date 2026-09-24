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

/** When the session was last written, and which of those writes has been exported. */
export interface EditSessionState {
  /** Epoch ms of the last session write, or null with no session/meta sidecar. */
  savedAt: number | null;
  /** The `savedAt` that was burned into an export, or null if none ever was. */
  exportedSavedAt: number | null;
}

const NO_SESSION: EditSessionState = { savedAt: null, exportedSavedAt: null };

/**
 * The session's save/export stamps for one item. Read-only, like `probeEditing`, and
 * one read for both values — `list()` runs this per item, so a second open of the
 * same sidecar would double the syscalls for nothing.
 *
 * The library badge compares the two for equality. It deliberately does NOT compare
 * `savedAt` against the exports' `createdAt`: see `SessionMeta.exportedSavedAt` for
 * why that comparison could never be right.
 */
export async function probeEditSession(vaultDir: string, id: string): Promise<EditSessionState> {
  if (!(await hasEditSession(vaultDir, id))) return NO_SESSION;
  try {
    const meta = JSON.parse(await readFile(sessionMetaPath(vaultDir, id), "utf-8")) as SessionMeta;
    return {
      savedAt: typeof meta.savedAt === "number" ? meta.savedAt : null,
      // Sessions written before the stamp existed have no field here. Reading that as
      // null means a pre-existing edited recording shows "not exported" until its next
      // export — the honest answer, since nothing recorded that it ever was.
      exportedSavedAt: typeof meta.exportedSavedAt === "number" ? meta.exportedSavedAt : null,
    };
  } catch {
    return NO_SESSION;
  }
}
