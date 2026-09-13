import { RESERVATION_GRACE_SECONDS } from "@kaipu/domain/constants";
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Reservations whose ticket expired more than the grace period ago can no longer
 * be written (presigned URLs check expiry at request start) — release them and
 * delete anything that landed without a confirm. Idempotent; bounded by `limit`.
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
    for (const key of [revision.storageKey, revision.thumbnailKey]) {
      if (!key) continue;
      if (await params.storage.headObject(key)) {
        await params.storage.deleteObject(key);
        deletedObjects += 1;
      }
    }
    if (await params.assets.release(revision.userId, revision.revisionId)) released += 1;
  }
  return { released, deletedObjects };
}
