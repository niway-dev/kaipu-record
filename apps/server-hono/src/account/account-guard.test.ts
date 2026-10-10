import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { assertAccountActive, assertFreshSession, FRESH_SESSION_MS } from "./account-guard";

const NOW = new Date("2026-10-10T12:00:00Z");

describe("assertAccountActive", () => {
  it("lets an active account through", () => {
    expect(() => assertAccountActive(null)).not.toThrow();
  });

  it("refuses an account scheduled for deletion with a kind the clients switch on", () => {
    const scheduledAt = new Date("2026-10-17T12:00:00Z");
    try {
      assertAccountActive({ userId: "u1", requestedAt: NOW, scheduledAt, locale: "en" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ORPCError);
      const e = err as ORPCError<string, unknown>;
      expect(e.code).toBe("FORBIDDEN");
      expect(e.data).toEqual({
        kind: "account-deletion-scheduled",
        scheduledAt: scheduledAt.toISOString(),
      });
    }
  });
});

describe("assertFreshSession", () => {
  it("accepts a session signed in within the last day and refuses an older one", () => {
    expect(() => assertFreshSession(new Date(NOW.getTime() - FRESH_SESSION_MS), NOW)).not.toThrow();
    expect(() => assertFreshSession(new Date(NOW.getTime() - FRESH_SESSION_MS - 1), NOW)).toThrow(
      /Sign in again/,
    );
  });
});
