import { describe, expect, it } from "vitest";
import { googleStartErrorKey, oauthErrorKey, parseOAuthErrorParam } from "./google-auth";

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

describe("googleStartErrorKey", () => {
  it("maps a server without a Google provider to the friendly unavailable message", () => {
    expect(
      googleStartErrorKey({
        code: "PROVIDER_NOT_FOUND",
        status: 404,
        message: "Provider not found. Make sure to add the provider in your auth config",
      }),
    ).toBe("googleUnavailable");
    expect(googleStartErrorKey({ status: 404 })).toBe("googleUnavailable");
  });

  it("maps any other failure to the generic message, never a raw error", () => {
    expect(googleStartErrorKey({ code: "SOMETHING", status: 500, message: "boom" })).toBe(
      "oauthErrorGeneric",
    );
    expect(googleStartErrorKey(null)).toBe("oauthErrorGeneric");
  });
});
