import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { scratchDrag, scratchParent } from "../workspaces/sync-state";

/** Hidden vault folder that already holds sidecars and thumbnails; drag copies live inside it. */
const META_DIR = ".kaipu";
/** A drag folder older than this is stale: the drop target has long finished reading it. */
export const DRAG_COPY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Parent of every per-drag directory. It lives inside the vault, so it is always on the vault's
 * volume: a hard link costs no space and no copy is needed (LIB-B12).
 */
export function dragRoot(vaultDir: string): string {
  return join(vaultDir, META_DIR, "drag");
}

/** Remove every drag copy of this vault (quit / startup). Best-effort: callers ignore failures. */
export async function cleanupDragCopies(vaultDir: string): Promise<void> {
  await rm(dragRoot(vaultDir), { recursive: true, force: true });
}

/** Remove every synced workspace's drag copies, `userData/workspace-scratch/<id>/drag`. */
export async function cleanupScratchDragCopies(userData: string): Promise<void> {
  const root = scratchParent(userData);
  let ids: string[];
  try {
    ids = await readdir(root);
  } catch {
    return;
  }
  await Promise.all(
    ids.map((id) =>
      rm(scratchDrag(userData, id), { recursive: true, force: true }).catch(() => {}),
    ),
  );
}

/** Remove the pre-LIB-B12 folder in the OS temp dir left by older builds. */
export async function cleanupLegacyDragCopies(tempDir: string): Promise<void> {
  await rm(join(tempDir, "kaipu-drag"), { recursive: true, force: true });
}

/**
 * Remove only the per-drag folders older than `maxAgeMs`, so a second drag never deletes the file
 * of a first drag whose drop target may still be reading it. Best-effort per folder.
 */
export async function pruneDragCopies(
  vaultDir: string,
  maxAgeMs: number = DRAG_COPY_MAX_AGE_MS,
  now: number = Date.now(),
  root: string = dragRoot(vaultDir),
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // no drag folder yet
  }
  await Promise.all(
    entries.map(async (entry) => {
      const dir = join(root, entry);
      try {
        const info = await stat(dir);
        if (now - info.mtimeMs > maxAgeMs) await rm(dir, { recursive: true, force: true });
      } catch {
        // Gone already, or locked by a drop target: leave it for the next prune.
      }
    }),
  );
}

/** A synced workspace's drag copy could not be made, so there is nothing safe to drag. */
export class SyncedDragCopyError extends Error {
  constructor(root: string, cause: unknown) {
    super(`cannot create a drag copy in "${root}"; a synced item is never dragged as itself`, {
      cause,
    });
    this.name = "SyncedDragCopyError";
  }
}

/**
 * The icon of a drag whose poster is offloaded (a 64 x 64 translucent gray PNG): the drag image
 * must not be read from the poster, because reading an offloaded file downloads it, and macOS
 * refuses a drag without an image.
 */
export const DRAG_PLACEHOLDER_ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAl0lEQVR4nO3QMREAIAzAwMruiDxkIeMHMvyey+ye+7PRAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA3QAVoDdIDWAB2gNUAHaA9WRYIONZ0KLgAAAABJRU5ErkJggg==",
  "base64",
);

/** The two filesystem calls whose failure decides the fallback; injectable for tests. */
export interface DragCopyFs {
  link: (existing: string, target: string) => Promise<void>;
  copyFile: (source: string, target: string, mode?: number) => Promise<void>;
}

export interface DragCopyOptions {
  /** Where the per-drag folders go; default `<vault>/.kaipu/drag`. */
  root?: string;
  /**
   * The workspace is synced (Google Drive, OneDrive, iCloud): the drag copy is a real copy,
   * never a hard link, and `root` is its scratch folder in userData (decision 15, NIW2-577). A
   * hard link inside the folder renames the cloud item to the drag copy's name; one out of it
   * leaves the item unsynced.
   */
  synced?: boolean;
}

/**
 * Create `<vault>/.kaipu/drag/<uuid>/<fileName>` for the vault file and return the path to drag.
 * A hard link costs no disk space. If the link crosses devices (EXDEV) the vault file itself is
 * returned (no copy, the drag starts at once, under its id name); any other link failure (exFAT,
 * FAT) falls back to a copy. In a synced workspace (`options.synced`) it is always a real copy
 * in `options.root`, outside the folder, never a link, and never the original: when the copy's
 * folder cannot be made it throws {@link SyncedDragCopyError}. Earlier drag folders are only
 * pruned when older than `DRAG_COPY_MAX_AGE_MS`.
 */
export async function createDragCopy(
  vaultDir: string,
  vaultFile: string,
  fileName: string,
  fs: DragCopyFs = { link, copyFile },
  options: DragCopyOptions = {},
): Promise<string> {
  const root = options.root ?? dragRoot(vaultDir);
  await pruneDragCopies(vaultDir, DRAG_COPY_MAX_AGE_MS, Date.now(), root).catch(() => {});
  const dir = join(root, randomUUID());
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    // A synced workspace never drags the original: a drop on the same volume would MOVE it,
    // and moving a file out of a synced folder deletes it from the cloud. The drag is refused.
    if (options.synced) throw new SyncedDragCopyError(root, error);
    return vaultFile; // read-only vault: drag the original rather than fail
  }
  const target = join(dir, fileName);
  if (options.synced) {
    // A clone where the volume has them (APFS, same volume as userData): the drag starts at
    // once however large the take; elsewhere it is the full copy the no-link rule requires.
    await fs.copyFile(vaultFile, target, constants.COPYFILE_FICLONE);
    return target;
  }
  try {
    await fs.link(vaultFile, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return vaultFile;
    }
    await fs.copyFile(vaultFile, target);
  }
  return target;
}
