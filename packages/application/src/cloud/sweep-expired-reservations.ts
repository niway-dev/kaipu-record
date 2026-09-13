import { RESERVATION_GRACE_SECONDS } from "@kaipu/domain/constants";
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

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
 */
export async function sweepExpiredReservations(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  now: Date;
  limit: number;
}): Promise<{ released: number; deletedObjects: number }> {
  const before = new Date(params.now.getTime() - RESERVATION_GRACE_SECONDS * 1000);
  const expired = await params.assets.listReservedExpiredBefore(before, params.limit);
  let released = 0;
  let deletedObjects = 0;
  for (const revision of expired) {
    const claimed = await params.assets.release(revision.userId, revision.revisionId);
    if (!claimed) continue; // lost the race (e.g. confirmed since listing) — leave it alone
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
