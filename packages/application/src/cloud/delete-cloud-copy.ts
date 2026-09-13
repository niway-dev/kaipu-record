import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Task 0 #7. `beginDelete` persists the delete intent: it flips the revision to `deleting`,
 * hides the asset (clears its current pointer) and excludes it from automatic upload — all
 * BEFORE touching storage. Then the physical R2 delete is tried immediately. A storage failure is
 * not an error for the caller: the revision stays `deleting` and `retryPendingDeletes` (cron)
 * finishes it without any device. `physicallyRemoved` says which happened. Quota stops counting
 * in `finishDelete` (open decision, Task 0). Returns null for a stranger.
 */
export async function deleteCloudCopy(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
}): Promise<{ deleted: boolean; physicallyRemoved: boolean } | null> {
  const found = await params.assets.findAsset(params.userId, params.assetId);
  if (!found) return null;
  if (!found.current) return { deleted: false, physicallyRemoved: false };
  const deleting = await params.assets.beginDelete(params.userId, found.current.revisionId);
  if (!deleting) return { deleted: false, physicallyRemoved: false };
  try {
    await params.storage.deleteObject(deleting.storageKey);
    if (deleting.thumbnailKey) await params.storage.deleteObject(deleting.thumbnailKey);
  } catch {
    return { deleted: true, physicallyRemoved: false };
  }
  await params.assets.finishDelete(params.userId, deleting.revisionId);
  return { deleted: true, physicallyRemoved: true };
}
