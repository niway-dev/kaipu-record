import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";

/** Only "re-upload" (excluded = false, from the desktop's explicit action) clears the flag. */
export async function setAutoUploadExclusion(params: {
  assets: ICloudAssetRepository;
  userId: string;
  assetId: string;
  excluded: boolean;
}): Promise<CloudAssetSummary | null> {
  const asset = await params.assets.setAutoUploadExcluded(
    params.userId,
    params.assetId,
    params.excluded,
  );
  if (!asset) return null;
  const found = await params.assets.findAsset(params.userId, params.assetId);
  return toAssetSummary(asset, found?.current ?? null);
}
