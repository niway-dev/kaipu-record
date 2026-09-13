import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Release a reservation the client gave up on. Deletes whatever landed under the
 * key (a partial PUT never lands; a full one that was never confirmed does), then
 * frees the bytes. Idempotent: a second call reports `released: false`.
 */
export async function cancelUpload(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  revisionId: string;
}): Promise<{ released: boolean } | null> {
  const revision = await params.assets.findRevision(
    params.userId,
    params.assetId,
    params.revisionId,
  );
  if (!revision) return null;
  if (revision.status !== "reserved") return { released: false };
  await params.storage.deleteObject(revision.storageKey);
  if (revision.thumbnailKey) await params.storage.deleteObject(revision.thumbnailKey);
  const released = await params.assets.release(params.userId, params.revisionId);
  return { released: released !== null };
}
