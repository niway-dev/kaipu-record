import type { LocalRecording } from "@shared/types/library-storage";
import { currentVault } from "../library";

/** Stable, sortable id; mirrors the recording writer's timestamp scheme. */
function screenshotId(): string {
  return `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

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
  const id = meta.overwriteId ?? screenshotId();
  const vault = currentVault();
  await vault.writeImage(id, png);
  const now = Date.now();
  // Preserve the original createdAt when overwriting; stamp it for a new item.
  await vault.writeMeta(id, {
    title: meta.title,
    ...(meta.overwriteId ? {} : { createdAt: now }),
    ...(meta.manual ? { editorSavedAt: now } : {}),
  });
  const saved = await vault.describe(id);
  if (!saved) throw new Error(`screenshot save: could not describe ${id} after writing`);
  return saved;
}
