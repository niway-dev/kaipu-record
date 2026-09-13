/**
 * The account's cloud capacity as `GET /api/v1/me/storage` reports it (plan 01's
 * `StorageUsage`). Decimal bytes: 1 GB = 1,000,000,000.
 */
export interface StorageUsage {
  capacityBytes: number;
  usedBytes: number;
  /** Held by uploads in progress; not yet confirmed. */
  reservedBytes: number;
  availableBytes: number;
  pendingUploads: number;
  /** False while uploads are suspended globally (the operator switch). */
  uploadsEnabled: boolean;
  /** False when this account has no cloud access (beta not granted). */
  cloudUploads: boolean;
}

/**
 * What the capacity query produced. Never a zeroed `StorageUsage` for a failure:
 * a failed query must not render as "0 GB used".
 *   • stale — the query failed, but an earlier answer for the same account exists.
 */
export type StorageUsageResult =
  | { kind: "signed-out" }
  | { kind: "ok"; usage: StorageUsage; fetchedAt: number }
  | { kind: "stale"; usage: StorageUsage; fetchedAt: number }
  | { kind: "error" }
  /** The server has no capacity endpoint (404): cloud storage is not offered there yet. */
  | { kind: "not-available" }
  | { kind: "session-expired" };
