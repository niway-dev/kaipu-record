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
 * Write to a unique temp file, fsync, rename over `target`, then flush the folder (best effort).
 * A failure removes the temp file. With `stagingDir` (a synced workspace) the temp file lives
 * there, outside the folder the provider uploads, and only the final rename reaches it. A
 * rename the volumes refuse (EXDEV) falls back to a temp file beside `target`: a replace has no
 * other atomic form, and a save that fails is worse than a `.part` the provider briefly sees.
 */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  suffix = "tmp",
  stagingDir: string | null = null,
): Promise<void> {
  const temp = stagingDir
    ? join(stagingDir, basename(uniqueTempPath(target, suffix)))
    : uniqueTempPath(target, suffix);
  try {
    if (stagingDir) await mkdir(stagingDir, { recursive: true });
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
    if (stagingDir && (error as NodeJS.ErrnoException | null)?.code === "EXDEV") {
      return atomicWriteFile(target, data, suffix);
    }
    throw error;
  }
  await syncDir(dirname(target)).catch(() => {});
}
