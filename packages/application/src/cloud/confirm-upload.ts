import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import {
  UploadVerificationError,
  toAssetSummary,
  type CloudAssetSummary,
} from "@kaipu/domain/schemas";
import type { IStorageService, ObjectMetadata } from "@kaipu/domain/services";

function baseType(contentType: string | null): string {
  return (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * Promote a reserved revision once storage holds exactly the declared bytes.
 * Owner-scoped; returns null for a stranger. Idempotent: confirming a ready
 * revision returns it without touching accounting.
 */
export async function confirmUpload(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  revisionId: string;
  now?: Date;
}): Promise<CloudAssetSummary | null> {
  const { assets, storage, userId, assetId, revisionId } = params;
  const revision = await assets.findRevision(userId, assetId, revisionId);
  if (!revision) return null;

  if (revision.status === "reserved") {
    const head = await storage.headObject(revision.storageKey);
    verify(head, revision.sizeBytes, revision.contentType, revision.contentSha256);
    if (revision.thumbnailKey) {
      const thumb = await storage.headObject(revision.thumbnailKey);
      if (!thumb || thumb.sizeBytes !== revision.thumbnailBytes)
        throw new UploadVerificationError("thumbnail");
    }
    const ready = await assets.markReady(userId, revisionId, params.now ?? new Date());
    if (!ready) throw new UploadVerificationError("missing");
  } else if (revision.status !== "ready") {
    return null; // expired / deleting / deleted — nothing to confirm
  }

  const found = await assets.findAsset(userId, assetId);
  return found ? toAssetSummary(found.asset, found.current) : null;
}

function verify(
  head: ObjectMetadata | null,
  sizeBytes: number,
  contentType: string,
  sha256: string,
): void {
  if (!head) throw new UploadVerificationError("missing");
  if (head.sizeBytes !== sizeBytes) throw new UploadVerificationError("size");
  if (baseType(head.contentType) !== baseType(contentType))
    throw new UploadVerificationError("content-type");
  if (head.checksumSha256 !== null && head.checksumSha256 !== sha256)
    throw new UploadVerificationError("checksum");
}
