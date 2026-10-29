import type { LocalRecording } from "@shared/types/library-storage";
import { broadcastLibraryChanged, currentVault } from "../library";
import { ItemGoneError } from "../library/library-vault";

export interface SaveScreenshotMeta {
  title: string;
  overwriteId?: string;
  /** A save the user asked for (not the capture's auto-save): puts the shot on the Continue list. */
  manual?: boolean;
}

/**
 * The one vault write for screenshots. The `screenshot:save` handler and the quiet
 * capture path both call it, so an auto-saved shot looks the same whoever saved it.
 */
export async function saveScreenshotToVault(
  png: Buffer,
  meta: SaveScreenshotMeta,
): Promise<LocalRecording> {
  const vault = currentVault();
  const now = Date.now();
  const isNew = meta.overwriteId === undefined;
  let id: string;
  if (meta.overwriteId === undefined) {
    // The file name follows the title (ADR 0032); the stub sidecar reserves it, so two
    // shots in the same second get ` (2)` instead of overwriting each other.
    id = await vault.allocateId({ kind: "screenshot", title: meta.title, createdAt: now });
  } else {
    id = meta.overwriteId;
    // A rename moved (or a delete removed) the item: writing would resurrect a PNG
    // under the old name, a second copy of the shot.
    if (!(await vault.hasMedia(id))) throw new ItemGoneError(id);
  }
  try {
    await vault.writeImage(id, png);
    // Preserve the original createdAt when overwriting; stamp it for a new item.
    await vault.writeMeta(id, {
      title: meta.title,
      ...(isNew ? { createdAt: now } : {}),
      ...(meta.manual ? { editorSavedAt: now } : {}),
    });
  } catch (error) {
    // A new item without a sidecar would be saved again under a second id when the
    // caller retries, leaving this PNG orphaned. Remove it (and its reserved stem) so
    // the retry starts clean.
    if (isNew) await vault.remove(id).catch(() => {});
    throw error;
  }
  const saved = await vault.describe(id);
  if (!saved) throw new Error(`screenshot save: could not describe ${id} after writing`);
  // An editor already open on another item keeps its library list: without this it
  // never sees the new shot, and opening it there falls back to the Editor home.
  broadcastLibraryChanged();
  return saved;
}
