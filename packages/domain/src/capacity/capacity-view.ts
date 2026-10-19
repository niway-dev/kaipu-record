import type { StorageUsage } from "../schemas/cloud-asset";

/**
 * What a client's capacity query produced. Never a zeroed `StorageUsage` for a failure:
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

/**
 * What the capacity card renders, derived from the raw query result. Beta access and the
 * global upload switch arrive as flags on a successful answer; they are promoted to states
 * here so the card never draws a usage bar for an account that has no cloud at all.
 */
export type CapacityView =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error" }
  | { kind: "session-expired" }
  | { kind: "beta-unavailable" }
  | { kind: "not-available" }
  | { kind: "usage"; usage: StorageUsage; staleSince: number | null; suspended: boolean };

/** `null` means the query has not answered yet. */
export function toCapacityView(result: StorageUsageResult | null): CapacityView {
  if (result === null) return { kind: "loading" };
  switch (result.kind) {
    case "signed-out":
    case "error":
    case "session-expired":
    case "not-available":
      return { kind: result.kind };
    case "ok":
    case "stale":
      if (!result.usage.cloudUploads) return { kind: "beta-unavailable" };
      return {
        kind: "usage",
        usage: result.usage,
        staleSince: result.kind === "stale" ? result.fetchedAt : null,
        suspended: !result.usage.uploadsEnabled,
      };
  }
}

/** Bar segment widths in percent, clamped so bad server numbers can't overflow the track. */
export function barSegments(usage: StorageUsage): { used: number; reserved: number } {
  if (usage.capacityBytes <= 0) return { used: 0, reserved: 0 };
  const pct = (bytes: number): number => Math.max(0, (bytes / usage.capacityBytes) * 100);
  const used = Math.min(100, pct(usage.usedBytes));
  const reserved = Math.min(100 - used, pct(usage.reservedBytes));
  return { used, reserved };
}

/** Share of the capacity already committed (used + reserved), as a percentage. Not clamped. */
export function committedPercent(usage: StorageUsage): number {
  if (usage.capacityBytes <= 0) return 0;
  return ((usage.usedBytes + usage.reservedBytes) / usage.capacityBytes) * 100;
}

/** More committed than the plan includes, e.g. after a capacity reduction. */
export function isOverQuota(usage: StorageUsage): boolean {
  return usage.usedBytes + usage.reservedBytes > usage.capacityBytes;
}

/** At this share of committed capacity the UI shows a passive "almost full" notice. */
export const ALMOST_FULL_PERCENT = 90;

export function isAlmostFull(usage: StorageUsage): boolean {
  return !isOverQuota(usage) && committedPercent(usage) >= ALMOST_FULL_PERCENT;
}
