import type { StorageUsage, StorageUsageResult } from "@shared/types/cloud-storage";

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
  | { kind: "usage"; usage: StorageUsage; staleSince: number | null; suspended: boolean };

/** `null` means the query has not answered yet. */
export function toCapacityView(result: StorageUsageResult | null): CapacityView {
  if (result === null) return { kind: "loading" };
  switch (result.kind) {
    case "signed-out":
    case "error":
    case "session-expired":
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
