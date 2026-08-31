import type { IRecordingRepository } from "@kaipu/domain/repositories";
import type { RecordingBase } from "@kaipu/domain/schemas";

/** The caller's recordings, newest first. */
export async function listRecordings(params: {
  repo: IRecordingRepository;
  userId: string;
}): Promise<RecordingBase[]> {
  return params.repo.findAllByUserId(params.userId);
}
