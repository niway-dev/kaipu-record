import { describe, expect, it } from "vitest";
import {
  RESEND_COOLDOWN_MS,
  cooldownRemainingMs,
  readResendSentAt,
  withinResendCooldown,
  writeResendSentAt,
} from "./resend-cooldown";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("resend cooldown", () => {
  it("is two minutes, like the desktop card", () => {
    expect(RESEND_COOLDOWN_MS).toBe(120_000);
  });

  it("blocks until exactly two minutes after the send", () => {
    expect(withinResendCooldown(null, 1_000)).toBe(false);
    expect(withinResendCooldown(1_000, 1_000)).toBe(true);
    expect(withinResendCooldown(1_000, 1_000 + RESEND_COOLDOWN_MS - 1)).toBe(true);
    expect(withinResendCooldown(1_000, 1_000 + RESEND_COOLDOWN_MS)).toBe(false);
    expect(cooldownRemainingMs(1_000, 1_000 + 30_000)).toBe(90_000);
  });

  it("survives a reload: the send time is stored per user", () => {
    const store = memoryStore();
    writeResendSentAt("user-1", 5_000, store);
    expect(readResendSentAt("user-1", store)).toBe(5_000);
    expect(readResendSentAt("user-2", store)).toBeNull();
  });

  it("ignores garbage and unavailable storage instead of throwing", () => {
    expect(
      readResendSentAt("u", memoryStore({ "kaipu.verification-email-sent-at.u": "abc" })),
    ).toBe(null);
    expect(readResendSentAt("u", null)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readResendSentAt("u", blocked)).toBeNull();
    expect(() => writeResendSentAt("u", 1, blocked)).not.toThrow();
  });
});
