import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { LocalRecording } from "@shared/types/library-storage";
import { broadcastLibraryChanged, currentVault } from "../library";
import { activeWorkspace, requireCaptureWorkspace, workspaceGate } from "../workspaces";

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
  const isNew = meta.overwriteId === undefined;
  const vault = currentVault();
  // Overwriting: a sidecar that cannot be read refuses the save before the PNG is replaced,
  // instead of after (the metadata write below would throw with the new pixels already down).
  if (!isNew) await vault.sidecar(id);
  await vault.writeImage(id, png);
  const now = Date.now();
  try {
    // Preserve the original createdAt when overwriting; stamp it for a new item.
    await vault.writeMeta(id, {
      title: meta.title,
      ...(isNew ? { createdAt: now } : {}),
      ...(meta.manual ? { editorSavedAt: now } : {}),
    });
  } catch (error) {
    // A new item without a sidecar would be saved again under a second id when the
    // caller retries, leaving this PNG orphaned. Remove it so the retry starts clean.
    if (isNew) await rm(join(vault.directory, `${id}.png`), { force: true }).catch(() => {});
    throw error;
  }
  const saved = await vault.describe(id);
  if (!saved) throw new Error(`screenshot save: could not describe ${id} after writing`);
  // An editor already open on another item keeps its library list: without this it
  // never sees the new shot, and opening it there falls back to the Editor home.
  broadcastLibraryChanged();
  return saved;
}

/**
 * A capture's save, bound to the workspace the capture started in (ADR 0032, decision 9):
 * it writes only while that workspace is the active one, and only if its folder is
 * connected. Otherwise it throws and writes nothing, anywhere. `null` binds it to the
 * active workspace now.
 */
export function saveCaptureToWorkspace(
  workspaceId: string | null | undefined,
  png: Buffer,
  meta: SaveScreenshotMeta,
): Promise<LocalRecording> {
  return workspaceGate().runActive(workspaceId ?? activeWorkspace().id, async () => {
    await requireCaptureWorkspace();
    return saveScreenshotToVault(png, meta);
  });
}

/**
 * The editor's Save: stamped like every item call, and refused with a message naming the
 * workspace when its folder is not connected.
 *
 * The folder is probed BEFORE the call enters the gate. The probe can make a pending
 * workspace adopt its folder's id, which bumps the generation; inside the call, the window
 * would then report a save that did write as stale, and saving again would duplicate the
 * item. Probed first, the same adoption makes the call refuse before it writes anything.
 */
export async function saveEditedScreenshot(
  stamp: unknown,
  png: Buffer,
  meta: SaveScreenshotMeta,
): Promise<LocalRecording> {
  await requireCaptureWorkspace();
  return workspaceGate().run(stamp, () => saveScreenshotToVault(png, meta));
}
