import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { ticketWindowClosed, ticketWindowCutoff } from "./ticket-window";

/**
 * Finish deletes whose storage call failed mid-way, or that were deferred because the upload
 * ticket was still usable. Accounting settles only on success. Revisions whose ticket window is
 * still open are excluded by the listing itself (so they cannot crowd out settleable ones) and
 * re-checked here as a second line; a later run picks them up.
 */
export async function retryPendingDeletes(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  limit: number;
  now?: Date;
}): Promise<{ finished: number; failed: number }> {
  const now = params.now ?? new Date();
  const pending = await params.assets.listDeleting(params.limit, ticketWindowCutoff(now));
  let finished = 0;
  let failed = 0;
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
