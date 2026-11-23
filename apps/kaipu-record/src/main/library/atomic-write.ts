import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Per-key async mutex, module scope: it spans every `LibraryVault` instance
 * (`currentVault()` builds a new one per IPC call). Not re-entrant: never call
 * `withLock` with the same key from inside `fn`.
 */
const tails = new Map<string, Promise<void>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** `<target>.<pid>.<random>.<suffix>`: unique per call, so concurrent writers never share an inode. */
export function uniqueTempPath(target: string, suffix = "tmp"): string {
  return `${target}.${process.pid}.${randomUUID()}.${suffix}`;
}

/**
 * Codes a directory fsync fails with where the platform cannot do one (Windows opens no
 * directory handle; some file systems refuse the sync): nothing to flush there.
 */
const NO_DIR_SYNC = new Set(["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP", "EOPNOTSUPP"]);

/**
 * Flush a directory's entries, so a file just named in it survives a power loss. A no-op where
 * the platform cannot sync a directory; any other failure propagates.
 */
export async function syncDir(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (!code || !NO_DIR_SYNC.has(code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Where a write to `target` stages its temp file: the scratch folder of the synced workspace
 * that holds `target`, or null for a path no synced workspace holds (the temp file then sits
 * beside the target, as it always did). The workspaces module registers it at start-up; until
 * then every write is plain.
 */
export type StagingResolver = (target: string) => string | null;

let resolveStaging: StagingResolver = () => null;

/** Install the resolver `atomicWriteFile` asks when its caller names no staging folder. */
export function setStagingResolver(resolver: StagingResolver): void {
  resolveStaging = resolver;
}

/**
 * The one atomic write of everything Kaipu keeps in a workspace folder: a unique temp file,
 * fsync, rename over `target`, then a folder flush (best effort). A failure removes the temp.
 *
 * In a synced workspace (Google Drive, iCloud, OneDrive) no temp file may ever appear inside
 * the folder: the provider would upload it and could keep a conflict copy. So the temp file
 * lives in the workspace's scratch folder, outside the folder the provider uploads, and only
 * the final rename reaches it. `stagingDir` names that folder; left `undefined` it is looked
 * up from `target` (see `setStagingResolver`), so a writer that holds only a path cannot
 * forget; `null` means "plain, beside the target". A rename the volumes refuse (EXDEV) falls
 * back to a temp file beside `target`: a replace has no other atomic form, and a save that
 * fails is worse than a temp file the provider briefly sees.
 */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  suffix = "tmp",
  stagingDir: string | null | undefined = undefined,
): Promise<void> {
  const staging = stagingDir === undefined ? resolveStaging(target) : stagingDir;
  const temp = staging
    ? join(staging, basename(uniqueTempPath(target, suffix)))
    : uniqueTempPath(target, suffix);
  try {
    if (staging) await mkdir(staging, { recursive: true });
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    if (staging && (error as NodeJS.ErrnoException | null)?.code === "EXDEV") {
      return atomicWriteFile(target, data, suffix, null);
    }
    throw error;
  }
  await syncDir(dirname(target)).catch(() => {});
}
