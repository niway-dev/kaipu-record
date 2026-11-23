import { randomUUID } from "node:crypto";
import { access, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
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

/** Whether the resolver (the app's synced-folder detection) says `path` is in a synced folder. */
export function isSyncedPath(path: string): boolean {
  return resolveStaging(path) !== null;
}

/** Hidden folder that holds a cross-volume placement while it is copied (see below). */
export const VOLUME_STAGING_DIR = ".kaipu-staging";

export interface VolumeStagingDeps {
  /** Whether a folder is inside a synced folder; defaults to the app's detection. */
  isSynced?: (path: string) => boolean;
}

/**
 * Where a copy bound for `target` (a path in a synced folder) is staged when the rename from the
 * scratch folder is refused because the volumes differ (EXDEV): a hidden folder on the TARGET's
 * volume that the provider does not upload. It is made inside the nearest ancestor of the target
 * that (1) the synced-folder detection says is not synced, (2) is writable and (3) lives on the
 * same device as the target's folder, so the final rename is a same-volume rename and nothing
 * partial ever appears under the synced path. Null when there is no such ancestor (the provider's
 * mount is its own volume, or every ancestor is read-only): the caller fails and keeps the
 * original, because a partial file in the synced folder is worse than a failed write.
 */
export async function volumeStagingDir(
  target: string,
  deps: VolumeStagingDeps = {},
): Promise<string | null> {
  const isSynced = deps.isSynced ?? isSyncedPath;
  // The detection must claim the target itself: when it cannot say where the synced root is, no
  // ancestor can be told apart from the synced folder, and staging in one could land inside it.
  if (!isSynced(target)) return null;
  const folder = dirname(target);
  let device: number;
  try {
    device = (await stat(folder)).dev;
  } catch {
    return null;
  }
  for (let at = folder; ; at = dirname(at)) {
    if (!isSynced(at)) {
      try {
        const info = await stat(at);
        if (info.dev !== device) return null; // the provider's volume starts here: nothing above is on it
        await access(at, constants.W_OK);
        const staging = join(at, VOLUME_STAGING_DIR);
        await mkdir(staging, { recursive: true });
        return staging;
      } catch {
        // Not writable (or not creatable): keep climbing.
      }
    }
    if (dirname(at) === at) return null;
  }
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
 * forget; `null` means "plain, beside the target".
 *
 * A rename the volumes refuse (EXDEV: the scratch folder and the synced folder are on different
 * volumes) never falls back to a temp file inside the synced folder, which the provider would
 * upload while it is half written. The write is redone through `volumeStagingDir`, a hidden folder
 * on the target's own volume outside the synced root. With none, the write fails with the EXDEV
 * error: the previous file is untouched and nothing partial is placed.
 */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  suffix = "tmp",
  stagingDir: string | null | undefined = undefined,
  deps: AtomicWriteDeps = {},
): Promise<void> {
  const staging = stagingDir === undefined ? resolveStaging(target) : stagingDir;
  const renameFile = deps.rename ?? rename;
  const writeVia = async (folder: string | null): Promise<void> => {
    const temp = folder
      ? join(folder, basename(uniqueTempPath(target, suffix)))
      : uniqueTempPath(target, suffix);
    try {
      if (folder) await mkdir(folder, { recursive: true });
      const handle = await open(temp, "w");
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameFile(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  };
  try {
    await writeVia(staging);
  } catch (error) {
    if (!staging || (error as NodeJS.ErrnoException | null)?.code !== "EXDEV") throw error;
    const onVolume = await volumeStagingDir(target, deps);
    if (onVolume === null) throw error;
    await writeVia(onVolume);
  }
  await syncDir(dirname(target)).catch(() => {});
}

export interface AtomicWriteDeps extends VolumeStagingDeps {
  /** The rename that places the temp file; a test makes it refuse across volumes. */
  rename?: typeof rename;
}
