import { describe, expect, it } from "vitest";
import type { AuthStatus } from "./types/auth";
import { FREE_ENTITLEMENTS, isWatermarkRemovalGranted, type Entitlements } from "./entitlements";

const NOW = new Date("2026-09-06T12:00:00Z");

function pro(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    plan: "pro",
    status: "active",
    currentPeriodEnd: null,
    features: { watermarkRemoval: true },
    ...overrides,
  };
}

describe("isWatermarkRemovalGranted", () => {
  it("is false for a signed-out user", () => {
    expect(isWatermarkRemovalGranted({ kind: "signed-out" }, NOW)).toBe(false);
  });

  it("follows the feature the server derived for a signed-in user", () => {
    const status: AuthStatus = { kind: "signed-in", email: "a@b", name: "A", entitlements: pro() };
    expect(isWatermarkRemovalGranted(status, NOW)).toBe(true);
    expect(isWatermarkRemovalGranted({ ...status, entitlements: FREE_ENTITLEMENTS }, NOW)).toBe(
      false,
    );
  });

  it("keeps the last known entitlements while the server is unreachable", () => {
    const status: AuthStatus = { kind: "unknown", lastKnownEmail: "a@b", entitlements: pro() };
    expect(isWatermarkRemovalGranted(status, NOW)).toBe(true);
  });

  it("revokes offline once the cached period has ended, without trusting the stale feature flag", () => {
    const lapsed = pro({ currentPeriodEnd: "2026-09-01T00:00:00Z" });
    const status: AuthStatus = { kind: "unknown", lastKnownEmail: "a@b", entitlements: lapsed };
    expect(isWatermarkRemovalGranted(status, NOW)).toBe(false);
  });

  it("still grants offline while the cached period is in the future", () => {
    const current = pro({ currentPeriodEnd: "2026-10-01T00:00:00Z" });
    const status: AuthStatus = { kind: "unknown", lastKnownEmail: "a@b", entitlements: current };
    expect(isWatermarkRemovalGranted(status, NOW)).toBe(true);
  });

  it("is false in `unknown` when nothing was ever cached", () => {
    expect(isWatermarkRemovalGranted({ kind: "unknown" }, NOW)).toBe(false);
  });
});
