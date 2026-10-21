import type { StorageUsage } from "@kaipu/domain/schemas";
import type { StorageUsageResult } from "@kaipu/domain/capacity";

export type StorageFailure = "session-expired" | "not-available" | "error";

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

/** 401 means the session is gone, 404 means this server has no capacity endpoint, the rest is a fault. */
export function classifyStorageError(error: unknown): StorageFailure {
  const status = statusOf(error);
  if (status === 401) return "session-expired";
  if (status === 404) return "not-available";
  return "error";
}

export interface StorageQuerySnapshot {
  data: StorageUsage | undefined;
  error: unknown;
  isError: boolean;
  /** When `data` was last fetched successfully (ms since epoch). */
  dataUpdatedAt: number;
}

/**
 * Maps a query snapshot to what the capacity view renders. `null` means the first answer is still
 * in flight. A failure with no earlier answer never carries numbers, so it cannot render as zeros;
 * a failure with an earlier answer is `stale` and keeps those numbers.
 */
export function toStorageResult(query: StorageQuerySnapshot): StorageUsageResult | null {
  if (query.isError) {
    const failure = classifyStorageError(query.error);
    if (failure === "session-expired" || failure === "not-available") return { kind: failure };
    if (query.data) return { kind: "stale", usage: query.data, fetchedAt: query.dataUpdatedAt };
    return { kind: "error" };
  }
  if (query.data) return { kind: "ok", usage: query.data, fetchedAt: query.dataUpdatedAt };
  return null;
}
