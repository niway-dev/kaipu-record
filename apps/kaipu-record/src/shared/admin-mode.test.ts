import { describe, expect, it } from "vitest";
import { meEntitlementsSchema } from "@kaipu/domain/schemas";
import { FREE_ENTITLEMENTS } from "./entitlements";
import {
  ADMIN_MODE_ARG,
  adminAnswerFor,
  adminModeArg,
  adminModeState,
  computeAdminMode,
  readAdminModeArg,
} from "./admin-mode";

describe("computeAdminMode", () => {
  const cases: Array<{
    name: string;
    adminModeSetting: boolean;
    session: { admin: boolean } | null;
    expected: boolean;
  }> = [
    { name: "signed out, setting on", adminModeSetting: true, session: null, expected: false },
    { name: "signed out, setting off", adminModeSetting: false, session: null, expected: false },
    {
      name: "not admin, setting on",
      adminModeSetting: true,
      session: { admin: false },
      expected: false,
    },
    {
      name: "not admin, setting off",
      adminModeSetting: false,
      session: { admin: false },
      expected: false,
    },
    {
      name: "admin, setting off",
      adminModeSetting: false,
      session: { admin: true },
      expected: false,
    },
    { name: "admin, setting on", adminModeSetting: true, session: { admin: true }, expected: true },
  ];
  for (const { name, adminModeSetting, session, expected } of cases) {
    it(`${name} -> ${expected}`, () => {
      expect(computeAdminMode({ adminModeSetting, session })).toBe(expected);
    });
  }

  it("only a literal true counts: a hand-edited non-boolean setting does not", () => {
    expect(
      computeAdminMode({
        adminModeSetting: "true" as unknown as boolean,
        session: { admin: true },
      }),
    ).toBe(false);
  });
});

describe("adminAnswerFor", () => {
  it("accepts admin:true for the current session's user", () => {
    expect(adminAnswerFor({ userId: "u1", admin: true }, "u1")).toBe(true);
  });
  it("discards an answer for another user", () => {
    expect(adminAnswerFor({ userId: "u1", admin: true }, "u2")).toBe(false);
  });
  it("treats a missing userId as not admin, even with admin:true", () => {
    expect(adminAnswerFor({ admin: true }, "u1")).toBe(false);
  });
  it("treats a missing or non-true admin as false (an older server)", () => {
    expect(adminAnswerFor({ userId: "u1" }, "u1")).toBe(false);
    expect(adminAnswerFor({ userId: "u1", admin: "yes" }, "u1")).toBe(false);
  });
  it("is false with no session", () => {
    expect(adminAnswerFor({ userId: "u1", admin: true }, null)).toBe(false);
  });
});

describe("launch argument", () => {
  it("round-trips both values", () => {
    expect(readAdminModeArg(["electron", adminModeArg(true)])).toBe(true);
    expect(readAdminModeArg(["electron", adminModeArg(false)])).toBe(false);
  });
  it("is false when absent or malformed", () => {
    expect(readAdminModeArg(["electron"])).toBe(false);
    expect(readAdminModeArg([`${ADMIN_MODE_ARG}true`])).toBe(false);
  });
});

describe("adminModeState", () => {
  it("has nothing pending when a relaunch would compute the launch value", () => {
    expect(
      adminModeState({ effective: true, adminModeSetting: true, session: { admin: true } }),
    ).toEqual({ isAdmin: true, adminModeSetting: true, effective: true, restartPending: false });
  });
  it("is pending after sign-out while Admin mode is effective, and effective stays", () => {
    expect(adminModeState({ effective: true, adminModeSetting: true, session: null })).toEqual({
      isAdmin: false,
      adminModeSetting: true,
      effective: true,
      restartPending: true,
    });
  });
  it("is pending after the switch is turned on by an admin in User mode", () => {
    expect(
      adminModeState({ effective: false, adminModeSetting: true, session: { admin: true } })
        .restartPending,
    ).toBe(true);
  });
  it("is not pending for a non-admin whose setting is on in User mode", () => {
    expect(
      adminModeState({ effective: false, adminModeSetting: true, session: { admin: false } })
        .restartPending,
    ).toBe(false);
  });
});

describe("wire shape", () => {
  it("the literal fields match the domain schema the server answers with", () => {
    const answer = meEntitlementsSchema.parse({
      ...FREE_ENTITLEMENTS,
      currentPeriodEnd: null,
      userId: "u1",
      admin: true,
    });
    // adminAnswerFor reads exactly the keys the schema defines.
    expect(adminAnswerFor(answer, "u1")).toBe(true);
    expect(Object.keys(meEntitlementsSchema.shape)).toEqual(
      expect.arrayContaining(["userId", "admin"]),
    );
  });
});
