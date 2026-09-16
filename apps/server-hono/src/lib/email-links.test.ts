import { describe, expect, it } from "vitest";

import { buildResetUrl, buildVerifyUrl } from "./email-links";

describe("email link builders", () => {
  it("builds a verify link through the web proxy with an absolute callback", () => {
    const url = buildVerifyUrl("https://kaipu.app", "tok/en+1");
    expect(url).toBe(
      "https://kaipu.app/api/auth/verify-email?token=tok%2Fen%2B1&callbackURL=https%3A%2F%2Fkaipu.app%2Fauth%2Femail-verified",
    );
  });

  it("builds a reset link to the web reset page", () => {
    expect(buildResetUrl("https://kaipu.app", "abc")).toBe(
      "https://kaipu.app/auth/reset-password?token=abc",
    );
  });

  it("tolerates a trailing slash on the web url", () => {
    expect(buildResetUrl("https://kaipu.app/", "abc")).toBe(
      "https://kaipu.app/auth/reset-password?token=abc",
    );
  });
});
