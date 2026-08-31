import type { IRecordingRepository } from "@kaipu/domain/repositories";
import type { RecordingBase } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

export interface RecordingDownload {
  recording: RecordingBase;
  downloadUrl: string;
}

/** A presigned download URL for one of the caller's recordings, or null. */
export async function getRecordingDownloadUrl(params: {
  repo: IRecordingRepository;
  storage: IStorageService;
  userId: string;
  id: string;
}): Promise<RecordingDownload | null> {
  const recording = await params.repo.findById(params.id, params.userId);
  if (!recording) return null;
  const downloadUrl = await params.storage.createDownloadUrl(recording.storageKey);
  return { recording, downloadUrl };
}
