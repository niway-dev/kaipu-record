import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { ticketWindowClosed } from "./ticket-window";

/**
 * Finish deletes whose storage call failed mid-way, or that were deferred because the upload
 * ticket was still usable. Accounting settles only on success; revisions whose ticket window has
 * not closed yet are skipped and picked up by a later run.
 */
export async function retryPendingDeletes(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  limit: number;
  now?: Date;
}): Promise<{ finished: number; failed: number }> {
  const pending = await params.assets.listDeleting(params.limit);
  let finished = 0;
  let failed = 0;
  const now = params.now ?? new Date();
  for (const revision of pending) {
    if (!ticketWindowClosed(revision.ticketExpiresAt, now)) continue;
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
