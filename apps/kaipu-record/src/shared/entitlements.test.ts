import { describe, expect, it } from "vitest";
import { PLANS } from "@kaipu/domain/constants";
import type { AuthStatus } from "./types/auth";
import { entitlementsFromStatus, FREE_ENTITLEMENTS, type Entitlements } from "./entitlements";

const pro: Entitlements = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: null,
  features: {
    watermarkRemoval: true,
    cloudUploads: true,
    cloudStorageBytes: 1_000_000_000,
  },
};

describe("entitlementsFromStatus", () => {
  it("is null for a signed-out user", () => {
    expect(entitlementsFromStatus({ kind: "signed-out" })).toBeNull();
  });

  it("returns what the server derived for a signed-in user", () => {
    const status: AuthStatus = {
      kind: "signed-in",
      userId: "user-1",
      email: "a@b",
      name: "A",
      entitlements: pro,
    };
    expect(entitlementsFromStatus(status)).toBe(pro);
    expect(entitlementsFromStatus({ ...status, entitlements: FREE_ENTITLEMENTS })).toBe(
      FREE_ENTITLEMENTS,
    );
  });

  it("keeps the last cached entitlements while the server is unreachable", () => {
    expect(entitlementsFromStatus({ kind: "unknown", entitlements: pro })).toBe(pro);
  });

  it("is null in `unknown` when nothing was ever cached", () => {
    expect(entitlementsFromStatus({ kind: "unknown" })).toBeNull();
  });
});

describe("FREE_ENTITLEMENTS", () => {
  // The literal in entitlements.ts must match the domain plan table (it cannot import it).
  it("mirrors the Free plan in @kaipu/domain: 250 MB, no cloud until verified", () => {
    expect(FREE_ENTITLEMENTS.plan).toBe(PLANS.free.id);
    expect(FREE_ENTITLEMENTS.features.cloudStorageBytes).toBe(PLANS.free.cloudStorageBytes);
    expect(FREE_ENTITLEMENTS.features.cloudStorageBytes).toBe(250_000_000);
    expect(FREE_ENTITLEMENTS.features.cloudUploads).toBe(false);
  });
});
