import type { IRecordingRepository } from "@kaipu/domain/repositories";
import { RecordingNotUploadedError, type RecordingBase } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Mark a pending recording as ready once its upload completed. Owner-scoped.
 * Verifies the object actually landed in storage first — otherwise a client
 * that skips (or loses) the PUT could confirm a recording that 404s on every
 * later download.
 */
export async function confirmRecording(params: {
  repo: IRecordingRepository;
  storage: IStorageService;
  userId: string;
  id: string;
}): Promise<RecordingBase | null> {
  const { repo, storage, userId, id } = params;
  const recording = await repo.findById(id, userId);
  if (!recording) return null;

  const uploaded = await storage.objectExists(recording.storageKey);
  if (!uploaded) throw new RecordingNotUploadedError(recording.storageKey);

  return repo.markReady(id, userId);
}
