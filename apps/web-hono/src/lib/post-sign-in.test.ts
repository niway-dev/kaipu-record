import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNED_IN_PATH, resolvePostSignInPath } from "./post-sign-in";

describe("resolvePostSignInPath", () => {
  it("lands on the dashboard without a redirect param", () => {
    expect(DEFAULT_SIGNED_IN_PATH).toBe("/dashboard");
    expect(resolvePostSignInPath({})).toBe("/dashboard");
    expect(resolvePostSignInPath({ redirect: undefined })).toBe("/dashboard");
  });

  it("follows a valid same-origin path, with its query", () => {
    expect(resolvePostSignInPath({ redirect: "/dashboard/settings" })).toBe("/dashboard/settings");
    expect(resolvePostSignInPath({ redirect: "/dashboard/recordings?page=2" })).toBe(
      "/dashboard/recordings?page=2",
    );
  });

  it("ignores anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/ok\nnot-ok",
      "javascript:alert(1)",
      "dashboard",
      "",
      42,
      null,
    ]) {
      expect(resolvePostSignInPath({ redirect: bad })).toBe("/dashboard");
    }
  });
});
