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
