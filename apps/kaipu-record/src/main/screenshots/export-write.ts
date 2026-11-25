import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceConfirmed } from "../library/safe-place";

/**
 * Writes an export's bytes to the path the user chose in the save dialog. The bytes are written
 * and flushed to a private staging folder, then `replaceConfirmed` moves them over `path`. The
 * staging folder is removed whether the move succeeds or fails.
 *
 * See apps/documentation/src/content/docs/desktop/library-vault.mdx, "Exports to a user-chosen path".
 */
export async function writeExportFile(
  path: string,
  bytes: Uint8Array,
  stageRoot: string = tmpdir(),
): Promise<void> {
  const stageDir = await mkdtemp(join(stageRoot, "kaipu-export-"));
  try {
    const staged = join(stageDir, "export");
    const handle = await open(staged, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceConfirmed(staged, path);
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
