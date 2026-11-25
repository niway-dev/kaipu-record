/**
 * What the editor needs to know about a joined recording (ADR 0058) from the Library, and the
 * read of its cursor track (null when it does not exist; any other failure throws). Shared by the hook that loads joined recordings when
 * the editor opens, and by the loader, which needs the webcam metas BEFORE the editor exists.
 */
import type { CursorTrack } from "@shared/cursor-track";
import { parseCursorTrack } from "@shared/cursor-track";
import type { RecordingCapture } from "@shared/recording-capture";
import type { WebcamTrackMeta } from "@shared/webcam-track";

export interface JoinedLibraryEntry {
  webcam: WebcamTrackMeta | null;
  capture: RecordingCapture | null;
}

/**
 * The local recordings among `assetIds`, from one `listLibraryItems()` call, by assetId. An
 * asset that is gone, cloud-only (no local copy) or not a recording has no entry. Throws when
 * the library cannot be read: the callers decide what "unknown" means for them.
 */
export async function readJoinedLibrary(
  assetIds: readonly string[],
): Promise<Map<string, JoinedLibraryEntry>> {
  const out = new Map<string, JoinedLibraryEntry>();
  if (assetIds.length === 0) return out;
  const wanted = new Set(assetIds);
  const { items, vaultError } = await window.electronAPI.listLibraryItems();
  // An unreadable vault resolves with only the cached cloud items: a joined local recording would
  // look deleted. Reject so the callers' "cannot be read" paths run instead.
  if (vaultError !== null) throw new Error(vaultError);
  for (const item of items) {
    if (!wanted.has(item.assetId) || item.kind !== "recording" || item.local === null) continue;
    out.set(item.assetId, {
      webcam: item.local.webcam ?? null,
      capture: item.capture ?? item.local.capture ?? null,
    });
  }
  return out;
}

/**
 * The recording's cursor track, or null: a missing or malformed one is just "no pointer data".
 * A track that exists but cannot be read now (offloaded by a synced folder's provider, or a
 * provider that does not answer) is not "no pointer data": it REJECTS, so a join or a joined
 * clip is never built silently without the pointer data the recording has.
 */
export async function loadCursorTrackOrNull(id: string): Promise<CursorTrack | null> {
  const json = await window.electronAPI.loadCursorTrack(id);
  return json ? parseCursorTrack(json) : null;
}

/**
 * Whether any recording joined into a saved scene has a webcam track, for `reconcileWebcam`'s
 * `joinedHasWebcam`: a layer saved on a scene whose OPENED recording has no webcam must survive
 * when a joined one does. Read BEFORE the editor exists, so a scene is never stripped of its
 * layer for want of metas the hook has not loaded yet. When the library cannot be read the
 * answer is "yes" (keep the saved layer): dropping it would be the lossy mistake.
 */
export async function anyJoinedHasWebcam(
  sources: readonly { assetId: string }[] | undefined,
): Promise<boolean> {
  if (!sources || sources.length === 0) return false;
  try {
    const library = await readJoinedLibrary(sources.map((s) => s.assetId));
    return [...library.values()].some((entry) => entry.webcam !== null);
  } catch {
    return true;
  }
}
