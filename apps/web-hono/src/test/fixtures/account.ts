import type { StorageUsage } from "@kaipu/domain/schemas";
import type { AccountUser } from "@/components/account/profile-section";
import type { LinkedAccount } from "@/hooks/use-linked-accounts";

/**
 * Fixtures for the account page tests. Nothing here, or in the tests that use it, talks to a real
 * database, bucket, secret store or API: every answer is a literal.
 */

export const NOW = Date.parse("2026-10-11T12:00:00Z");

export const USER_VERIFIED: AccountUser = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  emailVerified: true,
};

export const USER_UNVERIFIED: AccountUser = { ...USER_VERIFIED, emailVerified: false };

export const ACCOUNT_PASSWORD: LinkedAccount = {
  id: "acc-1",
  providerId: "credential",
  createdAt: "2026-09-01T10:00:00Z",
};

export const ACCOUNT_GOOGLE: LinkedAccount = {
  id: "acc-2",
  providerId: "google",
  createdAt: "2026-09-15T10:00:00Z",
};

const GB = 1_000_000_000;

const BASE: StorageUsage = {
  capacityBytes: 1 * GB,
  usedBytes: 610_000_000,
  reservedBytes: 130_000_000,
  availableBytes: 260_000_000,
  pendingUploads: 1,
  uploadsEnabled: true,
  cloudUploads: true,
};

/** One per CapacityView state that comes from a successful answer. */
export const STORAGE = {
  usage: BASE,
  betaUnavailable: { ...BASE, cloudUploads: false },
  suspended: { ...BASE, uploadsEnabled: false },
  almostFull: {
    ...BASE,
    usedBytes: 920_000_000,
    reservedBytes: 0,
    availableBytes: 80_000_000,
    pendingUploads: 0,
  },
  overQuota: {
    ...BASE,
    usedBytes: 1_400_000_000,
    reservedBytes: 100_000_000,
    availableBytes: 0,
    pendingUploads: 0,
  },
} satisfies Record<string, StorageUsage>;

export const ENTITLEMENTS_FREE = {
  plan: "free" as const,
  status: "active" as const,
  currentPeriodEnd: null,
  features: { watermarkRemoval: false, cloudUploads: true, cloudStorageBytes: 1 * GB },
};

export const ENTITLEMENTS_PRO_UNTIL = {
  ...ENTITLEMENTS_FREE,
  plan: "pro" as const,
  currentPeriodEnd: "2027-01-15T12:00:00Z",
  features: { ...ENTITLEMENTS_FREE.features, cloudStorageBytes: 25 * GB },
};

/** What the oRPC client rejects with for an HTTP failure: it carries the status. */
export function orpcError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

export const envelope = <T>(data: T) => ({ data, error: null });
