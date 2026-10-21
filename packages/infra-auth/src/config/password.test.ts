import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

/** A hash exactly as the previous implementation (scryptSync + Buffer.equals) stored it. */
function legacyHash(password: string, hexSalt: string): string {
  return `${hexSalt}:${scryptSync(password, hexSalt, 64).toString("hex")}`;
}

const SALT = "0123456789abcdef0123456789abcdef";

describe("verifyPassword", () => {
  it("accepts a hash written by the previous scryptSync implementation", async () => {
    const stored = legacyHash("correct horse battery staple", SALT);
    await expect(
      verifyPassword({ hash: stored, password: "correct horse battery staple" }),
    ).resolves.toBe(true);
  });

  it("rejects the wrong password against a legacy hash", async () => {
    const stored = legacyHash("correct horse battery staple", SALT);
    await expect(
      verifyPassword({ hash: stored, password: "correct horse battery stapl" }),
    ).resolves.toBe(false);
  });

  it("round-trips with hashPassword and keeps the salt:key format", async () => {
    const stored = await hashPassword("pw-with-ünïcode");
    const [salt, key] = stored.split(":");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toMatch(/^[0-9a-f]{128}$/);
    await expect(verifyPassword({ hash: stored, password: "pw-with-ünïcode" })).resolves.toBe(true);
    await expect(verifyPassword({ hash: stored, password: "pw-with-unicode" })).resolves.toBe(
      false,
    );
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });

  it("returns false, never throws, on malformed stored values", async () => {
    for (const hash of ["", "nocolon", ":", `${SALT}:`, `:${"ab".repeat(64)}`]) {
      await expect(verifyPassword({ hash, password: "anything" })).resolves.toBe(false);
    }
  });

  it("returns false on a truncated or over-long stored key", async () => {
    const stored = legacyHash("pw", SALT);
    const [salt, key] = stored.split(":");
    await expect(
      verifyPassword({ hash: `${salt}:${key.slice(0, 64)}`, password: "pw" }),
    ).resolves.toBe(false);
    await expect(verifyPassword({ hash: `${salt}:${key}00`, password: "pw" })).resolves.toBe(false);
  });
});
