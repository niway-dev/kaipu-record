import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";

/**
 * `PUT /assets/{assetId}/workspace` (ADR 0032): record which desktop workspace the item lives
 * in, or clear it with null. Used by a move between workspaces and by "Assign to workspace…".
 * Idempotent; null when the caller owns no such live asset.
 */
export async function setAssetWorkspace(params: {
  assets: ICloudAssetRepository;
  userId: string;
  assetId: string;
  workspaceId: string | null;
}): Promise<CloudAssetSummary | null> {
  const asset = await params.assets.setWorkspace(params.userId, params.assetId, params.workspaceId);
  if (!asset) return null;
  const found = await params.assets.findAsset(params.userId, params.assetId);
  return toAssetSummary(asset, found?.current ?? null);
}
