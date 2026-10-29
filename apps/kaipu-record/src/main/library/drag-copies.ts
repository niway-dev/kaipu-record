import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

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
): Promise<void> {
  const root = dragRoot(vaultDir);
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

/** The two filesystem calls whose failure decides the fallback; injectable for tests. */
export interface DragCopyFs {
  link: (existing: string, target: string) => Promise<void>;
  copyFile: (source: string, target: string) => Promise<void>;
}

/**
 * Create `<vault>/.kaipu/drag/<uuid>/<fileName>` for the vault file and return the path to drag.
 * A hard link costs no disk space. If the link crosses devices (EXDEV) the vault file itself is
 * returned (no copy, the drag starts at once, under its id name); any other link failure (exFAT,
 * FAT) falls back to a copy. Earlier drag folders are only pruned when older than
 * `DRAG_COPY_MAX_AGE_MS`.
 */
export async function createDragCopy(
  vaultDir: string,
  vaultFile: string,
  fileName: string,
  fs: DragCopyFs = { link, copyFile },
): Promise<string> {
  await pruneDragCopies(vaultDir).catch(() => {});
  const dir = join(dragRoot(vaultDir), randomUUID());
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    return vaultFile; // read-only vault: drag the original rather than fail
  }
  const target = join(dir, fileName);
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
