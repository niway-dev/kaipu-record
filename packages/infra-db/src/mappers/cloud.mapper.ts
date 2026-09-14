import type { CloudAsset, CloudRevision } from "@kaipu/domain/schemas";
import type { cloudAssetTable, cloudRevisionTable } from "../schema/cloud";

type AssetRow = typeof cloudAssetTable.$inferSelect;
type RevisionRow = typeof cloudRevisionTable.$inferSelect;

export function mapCloudAssetToDomain(row: AssetRow): CloudAsset {
  return {
    assetId: row.assetId,
    userId: row.userId,
    kind: row.kind as CloudAsset["kind"],
    title: row.title,
    currentRevisionId: row.currentRevisionId,
    durationSeconds: row.durationSeconds,
    derivedFromAssetId: row.derivedFromAssetId,
    autoUploadExcluded: row.autoUploadExcluded,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function mapCloudRevisionToDomain(row: RevisionRow): CloudRevision {
  return {
    revisionId: row.revisionId,
    assetId: row.assetId,
    userId: row.userId,
    intentKey: row.intentKey,
    status: row.status as CloudRevision["status"],
    storageKey: row.storageKey,
    thumbnailKey: row.thumbnailKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    thumbnailBytes: row.thumbnailBytes,
    contentSha256: row.contentSha256,
    reservedBytes: row.reservedBytes,
    ticketExpiresAt: row.ticketExpiresAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
