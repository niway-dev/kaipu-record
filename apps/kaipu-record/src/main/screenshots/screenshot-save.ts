import type { LocalRecording } from "@shared/types/library-storage";
import { broadcastLibraryChanged, currentVault } from "../library";

export interface SaveScreenshotMeta {
  title: string;
  overwriteId?: string;
  /**
   * The identity the editor expects at `overwriteId` — required with it. When a rename
   * moved the item, the overwrite follows it to its current id; it never writes over
   * another shot that took the old name. An overwrite without it is refused.
   */
  overwriteAssetId?: string;
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
  let id: string;
  if (meta.overwriteId === undefined) {
    // The file name follows the title (ADR 0032); the stub sidecar reserves it, so two
    // shots in the same second get ` (2)` instead of overwriting each other.
    id = await vault.allocateId({ kind: "screenshot", title: meta.title, createdAt: now });
    try {
      await vault.writeImage(id, png);
      await vault.writeMeta(id, {
        title: meta.title,
        createdAt: now,
        ...(meta.manual ? { editorSavedAt: now } : {}),
      });
    } catch (error) {
      // A new item without a sidecar would be saved again under a second id when the
      // caller retries, leaving this PNG orphaned. Remove it (and its reserved stem) so
      // the retry starts clean.
      await vault.remove(id).catch(() => {});
      throw error;
    }
  } else {
    // Checked and written under the vault's names lock, so a rename cannot slip in
    // between and leave the PNG resurrected under the old name. The original createdAt
    // is preserved.
    if (!meta.overwriteAssetId) {
      throw new Error("screenshot save: an overwrite needs overwriteAssetId");
    }
    id = await vault.overwriteImage(
      meta.overwriteId,
      png,
      { title: meta.title, ...(meta.manual ? { editorSavedAt: now } : {}) },
      meta.overwriteAssetId,
    );
  }
  const saved = await vault.describe(id);
  if (!saved) throw new Error(`screenshot save: could not describe ${id} after writing`);
  // An editor already open on another item keeps its library list: without this it
  // never sees the new shot, and opening it there falls back to the Editor home.
  broadcastLibraryChanged();
  return saved;
}
