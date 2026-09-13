import type { CloudAsset, CloudRevision } from "../schemas/cloud-asset";
import type { CloudAssetKind } from "../constants/cloud-limits";

/** Everything needed to reserve quota and insert the `reserved` revision atomically. */
export interface ReserveRevisionData {
  userId: string;
  assetId: string;
  intentKey: string;
  revisionId: string;
  kind: CloudAssetKind;
  title: string;
  durationSeconds: number;
  derivedFromAssetId: string | null;
  storageKey: string;
  thumbnailKey: string | null;
  contentType: string;
  sizeBytes: number;
  thumbnailBytes: number;
  contentSha256: string;
  /** sizeBytes + thumbnailBytes. */
  reservedBytes: number;
  ticketExpiresAt: Date;
  /** Quota ceiling for this account right now (from entitlements). */
  capacityBytes: number;
  /** `MAX_PENDING_UPLOADS_PER_ACCOUNT`, passed in so the repo stays policy-free. */
  maxPending: number;
}

export type ReserveOutcome =
  | { kind: "reserved"; asset: CloudAsset; revision: CloudRevision }
  | { kind: "quota-exceeded"; usedBytes: number; reservedBytes: number }
  | { kind: "too-many-pending" };

export interface AccountUsage {
  usedBytes: number;
  reservedBytes: number;
  pendingUploads: number;
}

export interface AssetPage {
  items: Array<{ asset: CloudAsset; current: CloudRevision | null }>;
  nextCursor: string | null;
}

export interface ICloudAssetRepository {
  /** Atomic: upserts the asset, reserves `reservedBytes` on the accounting row, inserts the revision. */
  reserve(data: ReserveRevisionData): Promise<ReserveOutcome>;
  /** The revision created for this (user, intentKey), if any — idempotent retries. */
  findByIntentKey(userId: string, intentKey: string): Promise<CloudRevision | null>;
  findRevision(userId: string, assetId: string, revisionId: string): Promise<CloudRevision | null>;
  findAsset(
    userId: string,
    assetId: string,
  ): Promise<{ asset: CloudAsset; current: CloudRevision | null } | null>;
  /**
   * Extend the ticket window of a still-`reserved` revision (re-issued ticket).
   * Returns false without writing anything when the revision is no longer `reserved`
   * (e.g. the sweep expired it between lookup and extend) — the caller must not sign
   * a ticket for a reservation that is already gone.
   */
  extendTicket(userId: string, revisionId: string, ticketExpiresAt: Date): Promise<boolean>;
  /**
   * `reserved` → `ready`: moves `reservedBytes` from reserved to used, decrements pending,
   * points the asset at this revision. No-op (returns the row) when already `ready`.
   */
  markReady(userId: string, revisionId: string, verifiedAt: Date): Promise<CloudRevision | null>;
  /** `reserved` → `expired`: releases the reservation. No-op when not `reserved`. */
  release(userId: string, revisionId: string): Promise<CloudRevision | null>;
  /** `ready` → `deleting`: clears the asset's current pointer if it was this revision. */
  beginDelete(userId: string, revisionId: string): Promise<CloudRevision | null>;
  /** `deleting` → `deleted`: subtracts `reservedBytes` from used. No-op when not `deleting`. */
  finishDelete(userId: string, revisionId: string): Promise<CloudRevision | null>;
  setAutoUploadExcluded(
    userId: string,
    assetId: string,
    excluded: boolean,
  ): Promise<CloudAsset | null>;
  /** Assets with a current ready revision, newest first, keyset-paginated. */
  listAssets(userId: string, params: { cursor: string | null; limit: number }): Promise<AssetPage>;
  usage(userId: string): Promise<AccountUsage>;
  /** Recompute the accounting row from revision rows (sweep + operator tool). */
  reconcile(userId: string): Promise<AccountUsage>;
  // --- sweep queries (cross-account, no owner scope) ---
  listReservedExpiredBefore(before: Date, limit: number): Promise<CloudRevision[]>;
  listDeleting(limit: number): Promise<CloudRevision[]>;
  /** Users whose accounting row was touched since `since` — candidates for `reconcile`. */
  listAccountsTouchedSince(since: Date, limit: number): Promise<string[]>;
}

/** Account purge queue, filled by the auth `beforeDelete` hook and drained by the sweep. */
export interface PurgeJob {
  id: string;
  userId: string;
  attempts: number;
  createdAt: Date;
}
export interface ICloudPurgeRepository {
  enqueue(userId: string): Promise<void>;
  nextPending(limit: number): Promise<PurgeJob[]>;
  markAttempt(id: string, error: string | null): Promise<void>;
  markDone(id: string): Promise<void>;
}
