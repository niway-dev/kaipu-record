import type { LocalRecording } from "@shared/types/library-storage";
import { broadcastLibraryChanged, currentVault } from "../library";
import type { CanvasSavePayload } from "@shared/types/screenshot-canvas";
import type { TextCacheSavePayload } from "@shared/types/text-recognition";
import { withItemLock } from "../library/item-lock";
import type { NewMedia } from "../library/library-vault";
import { clearCanvas, writeCanvas } from "./screenshot-canvas";
import { saveTextCache } from "./screenshot-text";
import { activeWorkspace, requireCaptureWorkspace, workspaceGate } from "../workspaces";

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
  /**
   * The editable canvas document and its image assets (ADR 0053). Stored beside the PNG after
   * it is written; a failure there never fails the save. An overwrite without it removes any
   * stored document, so a stale one never overrides newer flat pixels.
   */
  canvas?: CanvasSavePayload;
  /**
   * The recognized words for the canvas assets (ADR 0055), already stripped of every word a
   * baked redaction touches. Every save rewrites `<id>.text.json` from it; a save without it
   * (or without a stored canvas) deletes the file, so a hidden word never survives.
   */
  text?: TextCacheSavePayload;
  /** A frame capture: the video it was taken from and the second on screen. New items only. */
  source?: ScreenshotSource;
}

export interface ScreenshotSource {
  videoAssetId: string;
  /** The second in the source video; null for a frame of an image slide, which has none. */
  timeSeconds: number | null;
  /** The `SceneSource.id` of the joined copy it came from; null = the opened recording; absent = unknown. */
  sceneSourceId?: string | null;
}

/** The source from an IPC payload, or undefined when it is not a valid one (the save goes on without it). */
export function parseScreenshotSource(raw: unknown): ScreenshotSource | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { videoAssetId, timeSeconds, sceneSourceId } = raw as Record<string, unknown>;
  if (typeof videoAssetId !== "string" || videoAssetId.trim() === "") return undefined;
  // A malformed scene source only loses itself: the link still points at the right asset.
  const scene =
    sceneSourceId === null || (typeof sceneSourceId === "string" && sceneSourceId.trim() !== "")
      ? { sceneSourceId }
      : {};
  if (timeSeconds === null) return { videoAssetId, timeSeconds: null, ...scene };
  if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds) || timeSeconds < 0) {
    return undefined;
  }
  return { videoAssetId, timeSeconds, ...scene };
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
    // The file name follows the title (ADR 0035); the stub sidecar reserves it, so two
    // shots in the same second get ` (2)` instead of overwriting each other.
    const reservation = await vault.reserve({
      kind: "screenshot",
      title: meta.title,
      createdAt: now,
    });
    id = reservation.id;
    // A new item without a sidecar would be saved again under a second id when the caller
    // retries, leaving this PNG orphaned. So a failure gives back what this save made — never
    // a file that took `<id>.png` meanwhile.
    let media: NewMedia;
    try {
      media = await vault.writeImage(id, png);
    } catch (error) {
      await vault.releaseReservation(reservation).catch(() => {});
      throw error;
    }
    try {
      await vault.writeMeta(id, {
        title: meta.title,
        createdAt: now,
        ...(meta.manual ? { editorSavedAt: now } : {}),
        ...(meta.source
          ? {
              sourceVideoAssetId: meta.source.videoAssetId,
              sourceTimeSeconds: meta.source.timeSeconds,
              ...(meta.source.sceneSourceId !== undefined
                ? { sourceSceneSourceId: meta.source.sceneSourceId }
                : {}),
            }
          : {}),
      });
    } catch (error) {
      await vault.discardCreated(reservation, media).catch(() => {});
      throw error;
    }
    if (meta.canvas) await writeCanvas(vault, id, meta.canvas);
    await saveTextCache(vault, id, meta.text, meta.canvas);
  } else {
    // Checked and written under the vault's names lock, so a rename cannot slip in
    // between and leave the PNG resurrected under the old name. The original createdAt
    // is preserved.
    if (!meta.overwriteAssetId) {
      throw new Error("screenshot save: an overwrite needs overwriteAssetId");
    }
    const { overwriteId, overwriteAssetId } = meta;
    // Under the item lock: an overwrite never interleaves with a move of the same shot.
    id = await withItemLock(vault.workspaceId ?? vault.directory, overwriteId, async () => {
      const written = await vault.overwriteImage(
        overwriteId,
        png,
        { title: meta.title, ...(meta.manual ? { editorSavedAt: now } : {}) },
        overwriteAssetId,
      );
      // After the PNG, with the id it ended up under (a rename may have moved it). A
      // followed rename means another id: lock that one too, or a rename of it could land
      // between the PNG and the document. Every caller locks one id, so no cycle. The text
      // cache is written after the canvas, under the same lock.
      const canvasStep = async (): Promise<void> => {
        if (meta.canvas) await writeCanvas(vault, written, meta.canvas);
        else await clearCanvas(vault, written);
        await saveTextCache(vault, written, meta.text, meta.canvas);
      };
      if (written === overwriteId) await canvasStep();
      else await withItemLock(vault.workspaceId ?? vault.directory, written, canvasStep);
      return written;
    });
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
