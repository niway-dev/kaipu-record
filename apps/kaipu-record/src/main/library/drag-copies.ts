import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";

/** Parent of every per-drag directory; wiped as a whole on the next drag and on quit. */
function dragRoot(): string {
  return join(app.getPath("temp"), "kaipu-drag");
}

/** Remove every earlier drag copy. Best-effort: callers ignore failures. */
export async function cleanupDragCopies(): Promise<void> {
  await rm(dragRoot(), { recursive: true, force: true });
}

/**
 * Create `<temp>/kaipu-drag/<uuid>/<fileName>` for the vault file and return its path. A hard
 * link costs no disk space; across devices (EXDEV) it falls back to a copy.
 */
export async function createDragCopy(vaultFile: string, fileName: string): Promise<string> {
  // The drop target has already read any earlier file by the time a new drag starts.
  await cleanupDragCopies();
  const dir = join(dragRoot(), randomUUID());
  await mkdir(dir, { recursive: true });
  const target = join(dir, fileName);
  try {
    await link(vaultFile, target);
  } catch {
    await copyFile(vaultFile, target);
  }
  return target;
}
