import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, resolvePostSignInPath } from "./post-sign-in";

describe("resolvePostSignInPath", () => {
  it("lands on the dashboard when nothing was asked for", () => {
    expect(DEFAULT_SIGNED_IN_PATH).toBe("/dashboard");
    expect(resolvePostSignInPath({})).toBe("/dashboard");
    expect(resolvePostSignInPath(undefined)).toBe("/dashboard");
    expect(resolvePostSignInPath({ redirect: undefined })).toBe("/dashboard");
  });

  it("follows a same-origin path, query string included", () => {
    expect(resolvePostSignInPath({ redirect: "/dashboard/profile" })).toBe("/dashboard/profile");
    expect(resolvePostSignInPath({ redirect: "/dashboard/settings?tab=plan" })).toBe(
      "/dashboard/settings?tab=plan",
    );
  });

  it.each([
    ["an absolute URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash", "/\\evil.example"],
    ["a tab inside the path", "/\t/evil.example"],
    ["a newline inside the path", "/\n/evil.example"],
    ["a relative path", "dashboard"],
    ["an empty string", ""],
    ["a non-string value", 42],
  ])("ignores %s", (_label, redirect) => {
    expect(resolvePostSignInPath({ redirect })).toBe("/dashboard");
  });
});
