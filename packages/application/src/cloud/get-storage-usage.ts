import type { ICloudAccessRepository, ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { Entitlements, StorageUsage } from "@kaipu/domain/schemas";

export async function getStorageUsage(params: {
  assets: ICloudAssetRepository;
  access: ICloudAccessRepository;
  userId: string;
  entitlements: Entitlements;
}): Promise<StorageUsage> {
  const [usage, control] = await Promise.all([
    params.assets.usage(params.userId),
    params.access.getControl(),
  ]);
  const capacityBytes = params.entitlements.features.cloudStorageBytes;
  return {
    capacityBytes,
    usedBytes: usage.usedBytes,
    reservedBytes: usage.reservedBytes,
    availableBytes: Math.max(0, capacityBytes - usage.usedBytes - usage.reservedBytes),
    pendingUploads: usage.pendingUploads,
    uploadsEnabled: control.uploadsEnabled,
    cloudUploads: params.entitlements.features.cloudUploads,
  };
}
