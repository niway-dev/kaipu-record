import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { ticketWindowClosed, ticketWindowClosesAt } from "./ticket-window";

/**
 * `deferredUntil` is set when the physical delete was postponed because the revision's upload
 * ticket can still write; the router logs `cloud.delete.deferred` with it. The public contract
 * still answers `{ deleted: boolean }`.
 */
export interface DeleteCloudCopyResult {
  deleted: boolean;
  physicallyRemoved: boolean;
  deferredUntil: Date | null;
}

/**
 * Task 0 #7. `beginDelete` persists the delete intent: it flips the revision to `deleting`,
 * hides the asset (clears its current pointer) and excludes it from automatic upload — all
 * BEFORE touching storage. Then the physical R2 delete is tried immediately. A storage failure is
 * not an error for the caller: the revision stays `deleting` and `retryPendingDeletes` (cron)
 * finishes it without any device. `physicallyRemoved` says which happened. Quota stops counting
 * in `finishDelete` (open decision, Task 0). Returns null for a stranger.
 *
 * If the revision's upload ticket can still start a write (confirmed shortly after issue), the
 * physical delete is deferred to `retryPendingDeletes`: deleting now would let the still-valid
 * ticket re-create the object unaccounted. The revision stays `deleting` and keeps counting.
 * A `ready` revision's ticket can no longer be extended (`extendTicket` requires `reserved`), so
 * the expiry read here cannot move under us.
 */
export async function deleteCloudCopy(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  now?: Date;
}): Promise<DeleteCloudCopyResult | null> {
  const found = await params.assets.findAsset(params.userId, params.assetId);
  if (!found) return null;
  const nothing = { deleted: false, physicallyRemoved: false, deferredUntil: null };
  if (!found.current) return nothing;
  const deleting = await params.assets.beginDelete(params.userId, found.current.revisionId);
  if (!deleting) return nothing;
  if (!ticketWindowClosed(deleting.ticketExpiresAt, params.now ?? new Date())) {
    return {
      deleted: true,
      physicallyRemoved: false,
      deferredUntil: ticketWindowClosesAt(deleting.ticketExpiresAt),
    };
  }
  try {
    await params.storage.deleteObject(deleting.storageKey);
    if (deleting.thumbnailKey) await params.storage.deleteObject(deleting.thumbnailKey);
  } catch {
    return { deleted: true, physicallyRemoved: false, deferredUntil: null };
  }
  await params.assets.finishDelete(params.userId, deleting.revisionId);
  return { deleted: true, physicallyRemoved: true, deferredUntil: null };
}
