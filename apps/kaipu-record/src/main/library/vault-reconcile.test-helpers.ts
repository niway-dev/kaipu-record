import { mkdir, mkdtemp, readdir, readFile, lstat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { Sidecar } from "./library-vault";

/** A file's content, a directory, or a symlink to `target` (relative to the vault). */
export type FixtureEntry = string | { dir: true } | { symlink: string };

/** Build a temp vault from `files` (paths relative to the vault folder). */
export async function makeVault(files: Record<string, FixtureEntry>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kaipu-reconcile-"));
  await mkdir(join(directory, ".kaipu"), { recursive: true });
  for (const [path, entry] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    if (typeof entry === "string") await writeFile(target, entry);
    else if ("dir" in entry) await mkdir(target, { recursive: true });
    else await symlink(join(directory, entry.symlink), target);
  }
  return directory;
}

export const sidecar = (fields: Sidecar): string =>
  JSON.stringify({ sidecarVersion: 2, ...fields });

/** Every path under `directory` with its bytes and mtime: what "writes nothing" compares. */
export async function snapshot(directory: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const info = await lstat(path);
      const key = relative(directory, path);
      if (entry.isDirectory()) {
        out[key] = `dir@${info.mtimeMs}`;
        await walk(path);
      } else if (entry.isSymbolicLink()) {
        out[key] = `link@${info.mtimeMs}`;
      } else {
        out[key] = `${await readFile(path, "base64")}@${info.mtimeMs}`;
      }
    }
  };
  await walk(directory);
  return out;
}

/** Relative paths of every file under `directory` (directories excluded). */
export async function listFiles(directory: string): Promise<string[]> {
  return Object.entries(await snapshot(directory))
    .filter(([, value]) => !value.startsWith("dir@"))
    .map(([key]) => key)
    .sort();
}
