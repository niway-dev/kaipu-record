// Recording schemas + pure rules
export {
  recordingKindSchema,
  recordingStatusSchema,
  recordingBaseSchema,
  extensionForContentType,
  buildStorageKey,
  type RecordingKind,
  type RecordingStatus,
  type RecordingBase,
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

// Admin permission in /me/entitlements (ADR 0067)
export { meEntitlementsSchema, parseAdminUserIds, isAdminUser, type MeEntitlements } from "./admin";

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
  assetCursorSchema,
  decodeAssetCursor,
  encodeAssetCursor,
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
// Text recognition port (ADR 0055)
export {
  recognizedWordSchema,
  recognizedWordsSchema,
  MAX_RECOGNIZED_WORDS,
  wordsOutsideRects,
  wordsInReadingOrder,
  textOfWords,
  type RecognizedWord,
  type TextRecognizer,
} from "./text-recognition";
