import { z } from "zod";
import { maxBytesForKind, type CloudAssetKind } from "../constants/cloud-limits";

/** A cloud asset is a screen video or a screenshot (mirrors the local vault). */
export const cloudAssetKindSchema = z.enum(["recording", "screenshot"]);

/**
 * `reserved` — quota is held and a ticket may still write the object.
 * `ready`    — bytes verified in storage; counts as used space.
 * `deleting` — physical delete requested; still counts as used until it succeeds.
 * `expired`  — reservation released by cancel or by the sweep (tombstone).
 * `deleted`  — object gone and accounting settled (tombstone).
 */
export const REVISION_STATUSES = ["reserved", "ready", "deleting", "expired", "deleted"] as const;
export const revisionStatusSchema = z.enum(REVISION_STATUSES);
export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

const uuid = z.string().uuid();
/** Base64 of a 32-byte digest is always 44 chars ending in "=". */
const sha256Base64 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "Expected a base64 sha256 digest");

export const cloudAssetSchema = z.object({
  assetId: uuid,
  userId: z.string(),
  kind: cloudAssetKindSchema,
  title: z.string().min(1).max(500),
  currentRevisionId: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  derivedFromAssetId: uuid.nullable(),
  autoUploadExcluded: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type CloudAsset = z.infer<typeof cloudAssetSchema>;

export const cloudRevisionSchema = z.object({
  revisionId: z.string(),
  assetId: uuid,
  userId: z.string(),
  intentKey: z.string(),
  status: revisionStatusSchema,
  storageKey: z.string().min(1),
  thumbnailKey: z.string().nullable(),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  thumbnailBytes: z.number().int().nonnegative(),
  contentSha256: sha256Base64,
  /** sizeBytes + thumbnailBytes — what the accounting row holds for this revision. */
  reservedBytes: z.number().int().positive(),
  ticketExpiresAt: z.date(),
  verifiedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CloudRevision = z.infer<typeof cloudRevisionSchema>;

/** What clients see. Never carries storage keys. */
export const cloudAssetSummarySchema = z.object({
  assetId: uuid,
  kind: cloudAssetKindSchema,
  title: z.string(),
  currentRevisionId: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  contentSha256: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  hasThumbnail: z.boolean(),
  derivedFromAssetId: uuid.nullable(),
  autoUploadExcluded: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CloudAssetSummary = z.infer<typeof cloudAssetSummarySchema>;

export const createUploadIntentSchema = z.object({
  /** Stable identity minted by the client (sidecar). Same asset on re-upload. */
  assetId: uuid,
  /** One per attempt-to-upload-this-revision. Retrying with the same key is idempotent. */
  intentKey: uuid,
  kind: cloudAssetKindSchema,
  title: z.string().min(1).max(500),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentSha256: sha256Base64,
  durationSeconds: z.number().int().nonnegative().default(0),
  derivedFromAssetId: uuid.nullable().default(null),
  thumbnail: z
    .object({ sizeBytes: z.number().int().positive(), contentSha256: sha256Base64 })
    .nullable()
    .default(null),
});
export type CreateUploadIntent = z.infer<typeof createUploadIntentSchema>;

export const storageUsageSchema = z.object({
  capacityBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
  reservedBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  pendingUploads: z.number().int().nonnegative(),
  uploadsEnabled: z.boolean(),
  cloudUploads: z.boolean(),
});
export type StorageUsage = z.infer<typeof storageUsageSchema>;

// --- Pure rules (no I/O) ---------------------------------------------------

export const SUPPORTED_CONTENT_TYPES: Record<CloudAssetKind, readonly string[]> = {
  recording: ["video/mp4", "video/webm", "video/quicktime"],
  screenshot: ["image/png", "image/jpeg", "image/webp"],
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function baseType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() ?? "";
}

export function isSupportedContentType(kind: CloudAssetKind, contentType: string): boolean {
  return SUPPORTED_CONTENT_TYPES[kind].includes(baseType(contentType));
}

/** File extension for a supported content type; throws for anything else. */
export function extensionForContentType(contentType: string): string {
  const ext = EXTENSION_BY_CONTENT_TYPE[baseType(contentType)];
  if (!ext) throw new UnsupportedContentTypeError(contentType);
  return ext;
}

export function isValidUploadSize(kind: CloudAssetKind, sizeBytes: number): boolean {
  return Number.isInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= maxBytesForKind(kind);
}

/** Bytes the account must free before `newBytes` fit. 0 when it already fits. */
export function computeMissingBytes(
  usage: { capacityBytes: number; usedBytes: number; reservedBytes: number },
  newBytes: number,
): number {
  const committed = usage.usedBytes + usage.reservedBytes + newBytes;
  return Math.max(0, committed - usage.capacityBytes);
}

/** `videos/<userId>/<assetId>/<revisionId>.<ext>` or `img/…` — one prefix per account. */
export function buildRevisionStorageKey(params: {
  userId: string;
  assetId: string;
  revisionId: string;
  kind: CloudAssetKind;
  contentType: string;
}): string {
  const prefix = params.kind === "screenshot" ? "img" : "videos";
  return `${prefix}/${params.userId}/${params.assetId}/${params.revisionId}.${extensionForContentType(params.contentType)}`;
}

export function buildThumbnailStorageKey(params: {
  userId: string;
  assetId: string;
  revisionId: string;
  kind: CloudAssetKind;
}): string {
  const prefix = params.kind === "screenshot" ? "img" : "videos";
  return `${prefix}/${params.userId}/${params.assetId}/${params.revisionId}.thumb.jpg`;
}

/** Every key an account can own lives under one of these — used by the purge. */
export function accountPrefixes(userId: string): string[] {
  return [`videos/${userId}/`, `img/${userId}/`];
}

export function toAssetSummary(
  asset: CloudAsset,
  current: CloudRevision | null,
): CloudAssetSummary {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    title: asset.title,
    currentRevisionId: asset.currentRevisionId,
    contentType: current?.contentType ?? null,
    sizeBytes: current?.sizeBytes ?? null,
    contentSha256: current?.contentSha256 ?? null,
    durationSeconds: asset.durationSeconds,
    hasThumbnail: current?.thumbnailKey !== null && current?.thumbnailKey !== undefined,
    derivedFromAssetId: asset.derivedFromAssetId,
    autoUploadExcluded: asset.autoUploadExcluded,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

// --- Errors ----------------------------------------------------------------

export class QuotaExceededError extends Error {
  constructor(public readonly missingBytes: number) {
    super(`Not enough cloud space: ${missingBytes} more bytes are needed`);
    this.name = "QuotaExceededError";
  }
}
export class FileTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`File exceeds the per-file limit of ${limitBytes} bytes`);
    this.name = "FileTooLargeError";
  }
}
export class UnsupportedContentTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported content type "${contentType}"`);
    this.name = "UnsupportedContentTypeError";
  }
}
export class TooManyPendingUploadsError extends Error {
  constructor(limit: number) {
    super(`Too many uploads in progress (limit ${limit})`);
    this.name = "TooManyPendingUploadsError";
  }
}
export class UploadsDisabledError extends Error {
  constructor() {
    super("New cloud uploads are temporarily disabled");
    this.name = "UploadsDisabledError";
  }
}
export class CloudAccessDeniedError extends Error {
  constructor() {
    super("This account does not have cloud upload access");
    this.name = "CloudAccessDeniedError";
  }
}
export type UploadVerificationReason =
  | "missing"
  | "size"
  | "content-type"
  | "checksum"
  | "thumbnail";
export class UploadVerificationError extends Error {
  constructor(public readonly reason: UploadVerificationReason) {
    super(`Uploaded object does not match the declared revision (${reason})`);
    this.name = "UploadVerificationError";
  }
}
export class AssetConflictError extends Error {
  constructor(message = "Asset state conflicts with this request") {
    super(message);
    this.name = "AssetConflictError";
  }
}
export class RevisionNotReadyError extends Error {
  constructor() {
    super("The revision is not ready");
    this.name = "RevisionNotReadyError";
  }
}
/**
 * The intent key refers to a reservation that expired (swept) or was cancelled. Not a quota
 * problem: the client must start a new intent with a new key.
 */
export class UploadIntentExpiredError extends Error {
  constructor() {
    super("The upload intent expired; start a new one");
    this.name = "UploadIntentExpiredError";
  }
}
