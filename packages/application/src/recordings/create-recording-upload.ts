import type { IRecordingRepository } from "@kaipu/domain/repositories";
import {
  buildStorageKey,
  isWithinUploadLimit,
  type CreateRecordingUpload,
  type RecordingBase,
} from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

export interface CreateRecordingUploadResult {
  recording: RecordingBase;
  /** Presigned PUT URL the client uploads the bytes to, then calls confirm. */
  uploadUrl: string;
}

/**
 * Attach a new (pending) recording to the account and hand back a presigned
 * upload URL. The row is created first so the object is always owned before it
 * exists in storage; the client uploads to `uploadUrl`, then confirms.
 */
export async function createRecordingUpload(params: {
  repo: IRecordingRepository;
  storage: IStorageService;
  userId: string;
  input: CreateRecordingUpload;
}): Promise<CreateRecordingUploadResult> {
  const { repo, storage, userId, input } = params;

  if (!isWithinUploadLimit(input.sizeBytes)) {
    throw new Error("Recording exceeds the maximum upload size");
  }

  const id = crypto.randomUUID();
  const storageKey = buildStorageKey({
    userId,
    recordingId: id,
    kind: input.kind,
    contentType: input.contentType,
  });

  const recording = await repo.create({
    id,
    userId,
    kind: input.kind,
    title: input.title,
    storageKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    durationSeconds: input.durationSeconds,
  });

  const uploadUrl = await storage.createUploadUrl(storageKey, {
    contentType: input.contentType,
  });

  return { recording, uploadUrl };
}
