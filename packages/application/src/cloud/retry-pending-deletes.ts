import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/** Finish deletes whose storage call failed mid-way. Accounting settles only on success. */
export async function retryPendingDeletes(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  limit: number;
}): Promise<{ finished: number; failed: number }> {
  const pending = await params.assets.listDeleting(params.limit);
  let finished = 0;
  let failed = 0;
  for (const revision of pending) {
    try {
      await params.storage.deleteObject(revision.storageKey);
      if (revision.thumbnailKey) await params.storage.deleteObject(revision.thumbnailKey);
      if (await params.assets.finishDelete(revision.userId, revision.revisionId)) finished += 1;
    } catch {
      failed += 1;
    }
  }
  return { finished, failed };
}
