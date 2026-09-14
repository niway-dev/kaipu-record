import { DOWNLOAD_URL_TTL_SECONDS } from "@kaipu/domain/constants";
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/** Presigned GET for the owner's current ready revision; null otherwise (never reveals existence). */
export async function getAssetDownloadUrl(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  now?: Date;
}): Promise<{ asset: CloudAssetSummary; downloadUrl: string; expiresAt: Date } | null> {
  const found = await params.assets.findAsset(params.userId, params.assetId);
  if (!found?.current || found.current.status !== "ready") return null;
  const downloadUrl = await params.storage.createDownloadUrl(found.current.storageKey, {
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
  const now = params.now ?? new Date();
  return {
    asset: toAssetSummary(found.asset, found.current),
    downloadUrl,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  };
}
