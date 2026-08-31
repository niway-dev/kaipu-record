import type { IRecordingRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Delete a recording the caller owns: remove the row, then its object. Returns
 * false when nothing was deleted (not found / not owned).
 */
export async function deleteRecording(params: {
  repo: IRecordingRepository;
  storage: IStorageService;
  userId: string;
  id: string;
}): Promise<boolean> {
  const removed = await params.repo.delete(params.id, params.userId);
  if (!removed) return false;
  await params.storage.deleteObject(removed.storageKey);
  return true;
}
