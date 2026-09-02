import type { IRecordingRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Delete a recording the caller owns: remove its object, then the row. Returns
 * false when nothing was found (not found / not owned).
 *
 * Storage is deleted first (and is idempotent — a repeat delete of an
 * already-gone object still succeeds) so a failure here leaves the row intact
 * and the whole call safely retryable, instead of orphaning the R2 object with
 * no surviving reference to it.
 */
export async function deleteRecording(params: {
  repo: IRecordingRepository;
  storage: IStorageService;
  userId: string;
  id: string;
}): Promise<boolean> {
  const recording = await params.repo.findById(params.id, params.userId);
  if (!recording) return false;
  await params.storage.deleteObject(recording.storageKey);
  await params.repo.delete(params.id, params.userId);
  return true;
}
