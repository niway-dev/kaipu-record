// Recording schemas + pure rules
export {
  recordingKindSchema,
  recordingStatusSchema,
  recordingBaseSchema,
  createRecordingUploadSchema,
  MAX_UPLOAD_BYTES,
  isWithinUploadLimit,
  extensionForContentType,
  buildStorageKey,
  UploadLimitExceededError,
  RecordingNotUploadedError,
  type RecordingKind,
  type RecordingStatus,
  type RecordingBase,
  type CreateRecordingUpload,
} from "./recording";

// Subscription + entitlements (billing, kept apart from auth)
export {
  planSchema,
  subscriptionStatusSchema,
  subscriptionProviderSchema,
  subscriptionBaseSchema,
  entitlementsSchema,
  FREE_ENTITLEMENTS,
  isSubscriptionInForce,
  deriveEntitlements,
  type Plan,
  type SubscriptionStatus,
  type SubscriptionProvider,
  type SubscriptionBase,
  type Entitlements,
} from "./subscription";

// Pagination schemas
export {
  paginationQuerySchema,
  paginationMetaSchema,
  type PaginationQuery,
  type PaginationMeta,
} from "./pagination";

// Cloud assets + revisions (optional cloud)
export {
  cloudAssetKindSchema,
  REVISION_STATUSES,
  revisionStatusSchema,
  cloudAssetSchema,
  cloudRevisionSchema,
  cloudAssetSummarySchema,
  createUploadIntentSchema,
  storageUsageSchema,
  SUPPORTED_CONTENT_TYPES,
  isSupportedContentType,
  isValidUploadSize,
  computeMissingBytes,
  buildRevisionStorageKey,
  buildThumbnailStorageKey,
  accountPrefixes,
  toAssetSummary,
  QuotaExceededError,
  FileTooLargeError,
  UnsupportedContentTypeError,
  TooManyPendingUploadsError,
  UploadsDisabledError,
  CloudAccessDeniedError,
  UploadVerificationError,
  AssetConflictError,
  RevisionNotReadyError,
  UploadIntentExpiredError,
  type RevisionStatus,
  type CloudAsset,
  type CloudRevision,
  type CloudAssetSummary,
  type CreateUploadIntent,
  type StorageUsage,
  type UploadVerificationReason,
} from "./cloud-asset";

// Account deletion (soft delete with a grace period)
export {
  accountDeletionStatusSchema,
  AccountDeletionScheduledError,
  type AccountDeletionStatus,
} from "./account-deletion";
