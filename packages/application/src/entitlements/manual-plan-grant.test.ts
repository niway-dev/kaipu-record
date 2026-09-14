import type { IManualPlanGrantRepository } from "@kaipu/domain/repositories";
import type { SubscriptionBase } from "@kaipu/domain/schemas";
import { describe, expect, it } from "vitest";

import { grantManualPlan, ManualPlanGrantError, revokeManualPlan } from "./manual-plan-grant";

const NOW = new Date("2026-09-14T12:00:00Z");

function makeFakeRepo(
  users: Record<string, string>,
  rows: SubscriptionBase[] = [],
): IManualPlanGrantRepository & { rows: SubscriptionBase[] } {
  return {
    rows,
    async findUserIdByEmail(email) {
      return users[email] ?? null;
    },
    async findByUserId(userId) {
      return this.rows.find((r) => r.userId === userId) ?? null;
    },
    async upsertManualGrant(userId, plan) {
      const row: SubscriptionBase = {
        id: `sub-${userId}`,
        userId,
        plan,
        status: "active",
        currentPeriodEnd: null,
        provider: "manual",
        providerRef: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      this.rows = [...this.rows.filter((r) => r.userId !== userId), row];
      return row;
    },
    async deleteByUserId(userId) {
      this.rows = this.rows.filter((r) => r.userId !== userId);
    },
  };
}

function stripeRow(userId: string): SubscriptionBase {
  return {
    id: "sub-stripe",
    userId,
    plan: "pro",
    status: "active",
    currentPeriodEnd: NOW,
    provider: "stripe",
    providerRef: "sub_123",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("grantManualPlan", () => {
  it("grants pro to the account with the email, ignoring case and spaces", async () => {
    const repo = makeFakeRepo({ "me@example.com": "u1" });
    const row = await grantManualPlan({ repo, email: " Me@Example.com ", plan: "pro" });
    expect(row).toMatchObject({ userId: "u1", plan: "pro", provider: "manual", status: "active" });
    expect(row.currentPeriodEnd).toBeNull();
  });

  it("fails with user-not-found for an unknown email", async () => {
    const repo = makeFakeRepo({});
    await expect(
      grantManualPlan({ repo, email: "x@example.com", plan: "pro" }),
    ).rejects.toMatchObject({ code: "user-not-found" });
  });

  it("refuses to overwrite a row a billing provider owns", async () => {
    const repo = makeFakeRepo({ "me@example.com": "u1" }, [stripeRow("u1")]);
    await expect(grantManualPlan({ repo, email: "me@example.com", plan: "pro" })).rejects.toThrow(
      ManualPlanGrantError,
    );
    expect(repo.rows[0]?.provider).toBe("stripe");
  });
});

describe("revokeManualPlan", () => {
  it("deletes a manual grant so the account reverts to free", async () => {
    const repo = makeFakeRepo({ "me@example.com": "u1" });
    await grantManualPlan({ repo, email: "me@example.com", plan: "pro" });
    expect(await revokeManualPlan({ repo, email: "me@example.com" })).toBe(true);
    expect(repo.rows).toHaveLength(0);
  });

  it("returns false when the account has no grant", async () => {
    const repo = makeFakeRepo({ "me@example.com": "u1" });
    expect(await revokeManualPlan({ repo, email: "me@example.com" })).toBe(false);
  });

  it("refuses to delete a row a billing provider owns", async () => {
    const repo = makeFakeRepo({ "me@example.com": "u1" }, [stripeRow("u1")]);
    await expect(revokeManualPlan({ repo, email: "me@example.com" })).rejects.toMatchObject({
      code: "provider-owned",
    });
    expect(repo.rows).toHaveLength(1);
  });
});
