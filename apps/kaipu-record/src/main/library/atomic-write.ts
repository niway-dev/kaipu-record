import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

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

/** Write to a unique temp file, fsync, rename over `target`. A failure removes the temp file. */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  suffix = "tmp",
): Promise<void> {
  const temp = uniqueTempPath(target, suffix);
  try {
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
    throw error;
  }
}
