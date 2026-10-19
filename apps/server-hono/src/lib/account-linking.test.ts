import { describe, expect, it } from "vitest";
import {
  credentialDroppedNoticeId,
  decideLinkSideEffects,
  readGoogleIdTokenClaims,
  type LinkDecisionInput,
} from "./account-linking";

const EMAIL = "ada@example.com";
const CREDENTIAL = { id: "acc-cred", providerId: "credential" };
const OTHER_GOOGLE = { id: "acc-g-old", providerId: "google" };
const GOOGLE_OK = { email: EMAIL, emailVerified: true };

function input(overrides: Partial<LinkDecisionInput> = {}): LinkDecisionInput {
  return {
    providerId: "google",
    flow: "implicit",
    user: { email: EMAIL, emailVerified: false },
    existingAccounts: [CREDENTIAL],
    google: GOOGLE_OK,
    ...overrides,
  };
}

describe("decideLinkSideEffects — implicit sign-in", () => {
  it("new user (Google sign-up): nothing to do", () => {
    expect(decideLinkSideEffects(input({ existingAccounts: [] }))).toEqual({ kind: "none" });
  });

  it("new user whose Google email is not verified is still created (FR7)", () => {
    expect(
      decideLinkSideEffects(
        input({ existingAccounts: [], google: { email: EMAIL, emailVerified: false } }),
      ),
    ).toEqual({ kind: "none" });
  });

  it("verified credential account: links, keeps the password and sessions (FR5)", () => {
    expect(decideLinkSideEffects(input({ user: { email: EMAIL, emailVerified: true } }))).toEqual({
      kind: "none",
    });
  });

  it("unverified credential account: drops the password (FR6, pre-hijack)", () => {
    expect(decideLinkSideEffects(input())).toEqual({
      kind: "drop-unverified-credential",
      credentialAccountIds: ["acc-cred"],
    });
  });

  it("compares the emails case-insensitively", () => {
    expect(
      decideLinkSideEffects(input({ google: { email: "ADA@Example.com", emailVerified: true } })),
    ).toMatchObject({ kind: "drop-unverified-credential" });
  });

  it("unverified user with only another Google account: nothing to drop", () => {
    expect(decideLinkSideEffects(input({ existingAccounts: [OTHER_GOOGLE] }))).toEqual({
      kind: "none",
    });
  });

  it("drops every credential row, and only credential rows", () => {
    const second = { id: "acc-cred-2", providerId: "credential" };
    expect(
      decideLinkSideEffects(input({ existingAccounts: [CREDENTIAL, OTHER_GOOGLE, second] })),
    ).toEqual({
      kind: "drop-unverified-credential",
      credentialAccountIds: ["acc-cred", "acc-cred-2"],
    });
  });

  it("refuses to join an existing user when Google has not verified the email (FR7)", () => {
    expect(
      decideLinkSideEffects(input({ google: { email: EMAIL, emailVerified: false } })),
    ).toEqual({ kind: "refuse", reason: "google-email-not-verified" });
  });

  it("refuses when there is no id_token to prove the email", () => {
    expect(decideLinkSideEffects(input({ google: null }))).toEqual({
      kind: "refuse",
      reason: "google-email-not-verified",
    });
  });

  it("refuses when the verified Google email is not the user's email", () => {
    expect(
      decideLinkSideEffects(input({ google: { email: "eve@example.com", emailVerified: true } })),
    ).toEqual({ kind: "refuse", reason: "google-email-mismatch" });
  });

  it("refuses an unverified Google email even for a verified user", () => {
    expect(
      decideLinkSideEffects(
        input({
          user: { email: EMAIL, emailVerified: true },
          google: { email: EMAIL, emailVerified: false },
        }),
      ),
    ).toMatchObject({ kind: "refuse" });
  });
});

describe("decideLinkSideEffects — manual link (signed in, linkSocial)", () => {
  const manual = (overrides: Partial<LinkDecisionInput> = {}) =>
    input({ flow: "manual-link", ...overrides });

  it("same verified email on an unverified user: marks verified, keeps the password (Q4)", () => {
    expect(decideLinkSideEffects(manual())).toEqual({ kind: "mark-email-verified" });
  });

  it("never drops the password on a manual link", () => {
    for (const verified of [true, false]) {
      expect(
        decideLinkSideEffects(manual({ user: { email: EMAIL, emailVerified: verified } })).kind,
      ).not.toBe("drop-unverified-credential");
    }
  });

  it("different email: links without touching emailVerified (FR8)", () => {
    expect(
      decideLinkSideEffects(manual({ google: { email: "work@example.com", emailVerified: true } })),
    ).toEqual({ kind: "none" });
  });

  it("already verified user: nothing to do", () => {
    expect(decideLinkSideEffects(manual({ user: { email: EMAIL, emailVerified: true } }))).toEqual({
      kind: "none",
    });
  });

  it("Google email not verified: does not mark verified", () => {
    expect(
      decideLinkSideEffects(manual({ google: { email: EMAIL, emailVerified: false } })),
    ).toEqual({ kind: "none" });
  });

  it("no id_token: does not mark verified", () => {
    expect(decideLinkSideEffects(manual({ google: null }))).toEqual({ kind: "none" });
  });
});

describe("decideLinkSideEffects — other providers", () => {
  it("ignores credential rows (sign-up, setPassword)", () => {
    expect(decideLinkSideEffects(input({ providerId: "credential" }))).toEqual({ kind: "none" });
  });
});

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

describe("readGoogleIdTokenClaims", () => {
  it("reads email and email_verified", () => {
    expect(readGoogleIdTokenClaims(jwt({ email: EMAIL, email_verified: true }))).toEqual({
      email: EMAIL,
      emailVerified: true,
    });
  });

  it("accepts the string form of email_verified", () => {
    expect(
      readGoogleIdTokenClaims(jwt({ email: EMAIL, email_verified: "true" }))?.emailVerified,
    ).toBe(true);
  });

  it("treats a missing email_verified as unverified", () => {
    expect(readGoogleIdTokenClaims(jwt({ email: EMAIL }))).toEqual({
      email: EMAIL,
      emailVerified: false,
    });
  });

  it("decodes base64url payloads that need padding and use - and _", () => {
    const claims = { email: "a+b~?>@example.com", email_verified: true, name: "Ñandú ü" };
    expect(readGoogleIdTokenClaims(jwt(claims))?.email).toBe(claims.email);
  });

  it("returns null for a missing or malformed token", () => {
    expect(readGoogleIdTokenClaims(undefined)).toBeNull();
    expect(readGoogleIdTokenClaims("")).toBeNull();
    expect(readGoogleIdTokenClaims("not-a-jwt")).toBeNull();
    expect(readGoogleIdTokenClaims("a.%%%.c")).toBeNull();
  });
});

describe("credentialDroppedNoticeId", () => {
  it("is per user", () => {
    expect(credentialDroppedNoticeId("u1")).toBe("notice:credential-dropped:u1");
  });
});
