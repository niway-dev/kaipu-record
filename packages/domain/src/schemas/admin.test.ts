import { describe, expect, it } from "vitest";

import { isAdminUser, meEntitlementsSchema, parseAdminUserIds } from "./admin";
import { FREE_ENTITLEMENTS } from "./subscription";

describe("parseAdminUserIds", () => {
  it("returns nobody for a missing or empty value", () => {
    expect(parseAdminUserIds(undefined)).toEqual([]);
    expect(parseAdminUserIds("")).toEqual([]);
    expect(parseAdminUserIds("  ,, ,")).toEqual([]);
  });

  it("splits on commas, trims whitespace and drops empty entries", () => {
    expect(parseAdminUserIds(" u1 , u2,,u3 ,")).toEqual(["u1", "u2", "u3"]);
  });
});

describe("isAdminUser", () => {
  it("is true only for a listed id", () => {
    expect(isAdminUser("u2", "u1, u2")).toBe(true);
    expect(isAdminUser("u3", "u1, u2")).toBe(false);
  });

  it("matches the whole id, case-sensitively", () => {
    expect(isAdminUser("u1", "u10")).toBe(false);
    expect(isAdminUser("u10", "u1")).toBe(false);
    expect(isAdminUser("U1", "u1")).toBe(false);
  });

  it("is false for everyone when the list is missing or empty", () => {
    expect(isAdminUser("u1", undefined)).toBe(false);
    expect(isAdminUser("u1", "")).toBe(false);
    expect(isAdminUser("", "")).toBe(false);
  });
});

describe("meEntitlementsSchema", () => {
  it("extends the entitlements with userId and admin", () => {
    const parsed = meEntitlementsSchema.parse({ ...FREE_ENTITLEMENTS, userId: "u1", admin: true });
    expect(parsed.userId).toBe("u1");
    expect(parsed.admin).toBe(true);
  });
});
