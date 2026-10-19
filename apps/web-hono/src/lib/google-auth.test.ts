import { describe, expect, it } from "vitest";
import { isGoogleAuthEnabled, oauthErrorKey, parseOAuthErrorParam } from "./google-auth";

const env = (value?: string) => ({ VITE_GOOGLE_AUTH_ENABLED: value }) as ImportMetaEnv;

describe("isGoogleAuthEnabled", () => {
  it("is on only for the exact string true", () => {
    expect(isGoogleAuthEnabled(env("true"))).toBe(true);
    expect(isGoogleAuthEnabled(env("false"))).toBe(false);
    expect(isGoogleAuthEnabled(env("TRUE"))).toBe(false);
    expect(isGoogleAuthEnabled(env("1"))).toBe(false);
    expect(isGoogleAuthEnabled(env(undefined))).toBe(false);
  });
});

describe("oauthErrorKey", () => {
  it.each([
    ["account_not_linked", "oauthErrorNotLinked"],
    ["email_does_not_match", "oauthErrorEmailMismatch"],
    ["email_doesn't_match", "oauthErrorEmailMismatch"],
    ["state_security_mismatch", "oauthErrorExpired"],
    ["account_already_linked_to_different_user", "oauthErrorAlreadyLinked"],
    ["unable_to_link_account", "oauthErrorUnableToLink"],
    ["access_denied", "oauthErrorCancelled"],
    ["invalid_code", "oauthErrorExpired"],
    ["state_mismatch", "oauthErrorExpired"],
    ["please_restart_the_process", "oauthErrorExpired"],
  ])("maps %s to %s", (code, key) => {
    expect(oauthErrorKey(code)).toBe(key);
  });

  it("falls back to the generic copy for anything unknown, including prototype keys", () => {
    expect(oauthErrorKey("signup_disabled")).toBe("oauthErrorGeneric");
    expect(oauthErrorKey("toString")).toBe("oauthErrorGeneric");
    expect(oauthErrorKey("")).toBe("oauthErrorGeneric");
  });
});

describe("parseOAuthErrorParam", () => {
  it("keeps short printable codes", () => {
    expect(parseOAuthErrorParam("email_doesn't_match")).toBe("email_doesn't_match");
  });

  it("drops anything else", () => {
    expect(parseOAuthErrorParam(undefined)).toBeUndefined();
    expect(parseOAuthErrorParam(42)).toBeUndefined();
    expect(parseOAuthErrorParam("<script>")).toBeUndefined();
    expect(parseOAuthErrorParam("x".repeat(65))).toBeUndefined();
  });
});
