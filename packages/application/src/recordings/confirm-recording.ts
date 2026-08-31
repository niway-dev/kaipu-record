import type { IRecordingRepository } from "@kaipu/domain/repositories";
import type { RecordingBase } from "@kaipu/domain/schemas";

/** Mark a pending recording as ready once its upload completed. Owner-scoped. */
export async function confirmRecording(params: {
  repo: IRecordingRepository;
  userId: string;
  id: string;
}): Promise<RecordingBase | null> {
  return params.repo.markReady(params.id, params.userId);
}
