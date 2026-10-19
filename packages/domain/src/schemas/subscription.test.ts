import { describe, expect, it } from "vitest";

import { deriveEntitlements, FREE_ENTITLEMENTS, type SubscriptionBase } from "./subscription";

const NOW = new Date("2026-09-06T12:00:00Z");

function proSubscription(overrides: Partial<SubscriptionBase> = {}): SubscriptionBase {
  return {
    id: "sub-1",
    userId: "u1",
    plan: "pro",
    status: "active",
    currentPeriodEnd: null,
    provider: "manual",
    providerRef: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("deriveEntitlements", () => {
  it("treats a user with no subscription row as free", () => {
    expect(deriveEntitlements(null, NOW)).toEqual({
      plan: "free",
      status: "active",
      currentPeriodEnd: null,
      features: { watermarkRemoval: false, cloudUploads: false, cloudStorageBytes: 250_000_000 },
    });
  });

  it("grants watermark removal to an active pro with no period end", () => {
    const result = deriveEntitlements(proSubscription(), NOW);
    expect(result.plan).toBe("pro");
    expect(result.features.watermarkRemoval).toBe(true);
  });

  it("grants while the current period has not ended", () => {
    const sub = proSubscription({ currentPeriodEnd: new Date("2026-10-01T00:00:00Z") });
    expect(deriveEntitlements(sub, NOW).features.watermarkRemoval).toBe(true);
  });

  it("revokes features once the period has ended, but still reports the plan name", () => {
    const sub = proSubscription({ currentPeriodEnd: new Date("2026-09-01T00:00:00Z") });
    const result = deriveEntitlements(sub, NOW);
    expect(result.plan).toBe("pro");
    expect(result.currentPeriodEnd).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(result.features.watermarkRemoval).toBe(false);
  });

  it("revokes features when the subscription is not active", () => {
    expect(
      deriveEntitlements(proSubscription({ status: "canceled" }), NOW).features.watermarkRemoval,
    ).toBe(false);
    expect(
      deriveEntitlements(proSubscription({ status: "past_due" }), NOW).features.watermarkRemoval,
    ).toBe(false);
  });

  it("never grants features on the free plan, even when active", () => {
    const sub = proSubscription({ plan: "free" });
    expect(deriveEntitlements(sub, NOW).features.watermarkRemoval).toBe(false);
  });
});

describe("cloud entitlements", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const pro = {
    id: "s1",
    userId: "u1",
    plan: "pro" as const,
    status: "active" as const,
    currentPeriodEnd: null,
    provider: "manual" as const,
    providerRef: null,
    createdAt: now,
    updatedAt: now,
  };

  it("free accounts get 250 MB; cloudUploads follows email verification, not the plan", () => {
    const e = deriveEntitlements(null, now, { cloudAccess: false });
    expect(e.features.cloudStorageBytes).toBe(250_000_000);
    expect(e.features.cloudUploads).toBe(false);
    expect(deriveEntitlements(null, now, { cloudAccess: true }).features.cloudUploads).toBe(true);
  });

  it("a verified free account gets exactly 250 MB of cloud (NIW2-232)", () => {
    const e = deriveEntitlements(null, now, { cloudAccess: true });
    expect(e.plan).toBe("free");
    expect(e.features.cloudUploads).toBe(true);
    expect(e.features.cloudStorageBytes).toBe(250_000_000);
  });

  it("pro in force gets 15 GB; a lapsed pro falls back to 250 MB", () => {
    expect(deriveEntitlements(pro, now, { cloudAccess: true }).features.cloudStorageBytes).toBe(
      15_000_000_000,
    );
    const lapsed = { ...pro, currentPeriodEnd: new Date("2026-01-01T00:00:00Z") };
    expect(deriveEntitlements(lapsed, now, { cloudAccess: true }).features.cloudStorageBytes).toBe(
      250_000_000,
    );
  });

  it("FREE_ENTITLEMENTS carries the cloud fields", () => {
    expect(FREE_ENTITLEMENTS.features).toEqual({
      watermarkRemoval: false,
      cloudUploads: false,
      cloudStorageBytes: 250_000_000,
    });
  });
});
