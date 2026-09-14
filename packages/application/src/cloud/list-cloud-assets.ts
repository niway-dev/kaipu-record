import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";

export async function listCloudAssets(params: {
  assets: ICloudAssetRepository;
  userId: string;
  cursor: string | null;
  limit: number;
}): Promise<{ items: CloudAssetSummary[]; nextCursor: string | null }> {
  const page = await params.assets.listAssets(params.userId, {
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: page.items.map((i) => toAssetSummary(i.asset, i.current)),
    nextCursor: page.nextCursor,
  };
}
