import type { ISubscriptionRepository } from "@kaipu/domain/repositories";
import type { SubscriptionBase } from "@kaipu/domain/schemas";
import { describe, expect, it } from "vitest";

import { getEntitlements } from "./get-entitlements";

const NOW = new Date("2026-09-06T12:00:00Z");

function makeFakeRepo(rows: SubscriptionBase[]): ISubscriptionRepository {
  return {
    async findByUserId(userId) {
      return rows.find((r) => r.userId === userId) ?? null;
    },
  };
}

function manualPro(userId: string): SubscriptionBase {
  return {
    id: `sub-${userId}`,
    userId,
    plan: "pro",
    status: "active",
    currentPeriodEnd: null,
    provider: "manual",
    providerRef: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("getEntitlements", () => {
  it("returns free entitlements for a user without a subscription", async () => {
    const result = await getEntitlements({ repo: makeFakeRepo([]), userId: "u1", now: NOW });
    expect(result.plan).toBe("free");
    expect(result.features.watermarkRemoval).toBe(false);
  });

  it("returns the caller's own subscription, not another user's", async () => {
    const repo = makeFakeRepo([manualPro("u2")]);
    const mine = await getEntitlements({ repo, userId: "u1", now: NOW });
    const theirs = await getEntitlements({ repo, userId: "u2", now: NOW });
    expect(mine.features.watermarkRemoval).toBe(false);
    expect(theirs.features.watermarkRemoval).toBe(true);
  });

  it("defaults `now` to the current time", async () => {
    const lapsed = {
      ...manualPro("u1"),
      currentPeriodEnd: new Date(Date.now() - 1000),
    };
    const result = await getEntitlements({ repo: makeFakeRepo([lapsed]), userId: "u1" });
    expect(result.features.watermarkRemoval).toBe(false);
  });
});
