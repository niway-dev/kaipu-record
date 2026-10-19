import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { ticketWindowCutoff } from "./ticket-window";

/**
 * Reservations whose ticket expired more than the grace period ago can no longer
 * be written (presigned URLs check expiry at request start) — release them and
 * delete anything that landed without a confirm. Idempotent; bounded by `limit`.
 *
 * Claims each revision FIRST (`release` only succeeds while it is still `reserved`) and only
 * then attempts to delete its objects — a revision `confirmUpload` won the race on (flipped to
 * `ready` between the listing above and this loop) fails the claim here and is left completely
 * untouched, object included. A storage delete failure does not stop the sweep from counting the
 * revision released: the bytes are already reclaimed, and a stray object can be cleaned up later.
 *
 * The listing is strict (`ticketExpiresAt < cutoff`) while `ticketWindowClosed` is inclusive, so at
 * the exact closing instant the predicate already says closed and the sweep lists the revision one
 * tick later. Neither side releases before the window closes, which is the property that matters.
 * The claim repeats the window check in SQL (`ticketExpiredBy`), so a resumed intent that extends
 * the ticket after the listing makes the claim a no-op instead of stranding a fresh ticket.
 */
export async function sweepExpiredReservations(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  now: Date;
  limit: number;
}): Promise<{ released: number; deletedObjects: number }> {
  const before = ticketWindowCutoff(params.now);
  const expired = await params.assets.listReservedExpiredBefore(before, params.limit);
  let released = 0;
  let deletedObjects = 0;
  for (const revision of expired) {
    const claimed = await params.assets.release(revision.userId, revision.revisionId, {
      ticketExpiredBy: before,
    });
    if (!claimed) continue; // lost the race (confirmed or resumed since listing) — leave it alone
    released += 1;
    for (const key of [revision.storageKey, revision.thumbnailKey]) {
      if (!key) continue;
      try {
        if (await params.storage.headObject(key)) {
          await params.storage.deleteObject(key);
          deletedObjects += 1;
        }
      } catch {
        // The claim already succeeded; a stray object is acceptable, a failed sweep run is not.
      }
    }
  }
  return { released, deletedObjects };
}
