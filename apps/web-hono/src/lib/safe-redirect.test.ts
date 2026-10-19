import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("follows same-origin paths, with their query", () => {
    expect(safeRedirectPath("/account")).toBe("/account");
    expect(safeRedirectPath("/recordings?page=2#top")).toBe("/recordings?page=2#top");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example/account",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "account",
      "/\t/evil.example",
      "",
    ]) {
      expect(safeRedirectPath(bad)).toBeUndefined();
    }
  });

  it("refuses a value that is not a string", () => {
    expect(safeRedirectPath(undefined)).toBeUndefined();
    expect(safeRedirectPath(["/account"])).toBeUndefined();
  });
});
