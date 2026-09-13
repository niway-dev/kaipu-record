import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Release a reservation the client gave up on. Claims the reservation FIRST — `release` is a
 * status-guarded transition that only succeeds while the revision is still `reserved` — and only
 * once that succeeds does it try to delete whatever landed under the key (a partial PUT never
 * lands; a full one that was never confirmed does). This ordering matters: `confirmUpload` can
 * win a race between our read and our write, flipping the revision to `ready` first, in which
 * case `release` reports nothing claimed and the object is left untouched — a ready asset must
 * never lose its object. A storage failure after a successful claim is not an error for the
 * caller: the bytes are already released, and a stray object is acceptable (unlike a corrupt
 * ready asset). Idempotent: a second call reports `released: false`.
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
  const released = await params.assets.release(params.userId, params.revisionId);
  if (!released) return { released: false };
  try {
    await params.storage.deleteObject(revision.storageKey);
    if (revision.thumbnailKey) await params.storage.deleteObject(revision.thumbnailKey);
  } catch {
    // The claim already succeeded; a stray object is not this caller's problem to fail on.
  }
  return { released: true };
}
