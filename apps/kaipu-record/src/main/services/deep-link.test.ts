import { describe, expect, it } from "vitest";
import { findDeepLinkInArgv, parseDeepLink } from "./deep-link";

describe("parseDeepLink", () => {
  it("reads the token of the auth callback the server emits", () => {
    expect(parseDeepLink("kaipu:/auth/callback#token=abc_DEF-123")).toEqual({
      kind: "auth-callback",
      token: "abc_DEF-123",
    });
  });

  it("accepts the double-slash spelling of the same link", () => {
    expect(parseDeepLink("kaipu://auth/callback#token=abc")).toEqual({
      kind: "auth-callback",
      token: "abc",
    });
  });

  it("percent-decodes the token", () => {
    expect(parseDeepLink("kaipu:/auth/callback#token=a%3Db")).toEqual({
      kind: "auth-callback",
      token: "a=b",
    });
  });

  it("does not treat a callback without a token as a sign-in", () => {
    expect(parseDeepLink("kaipu:/auth/callback")).toEqual({
      kind: "unhandled",
      path: "/auth/callback",
    });
    expect(parseDeepLink("kaipu:/auth/callback#token=")).toEqual({
      kind: "unhandled",
      path: "/auth/callback",
    });
  });

  it("routes the reserved billing link and unknown paths to unhandled", () => {
    expect(parseDeepLink("kaipu://billing/refresh")).toEqual({
      kind: "unhandled",
      path: "/billing/refresh",
    });
    expect(parseDeepLink("kaipu:/something/else")).toEqual({
      kind: "unhandled",
      path: "/something/else",
    });
  });

  it("ignores anything that is not a Kaipu link", () => {
    expect(parseDeepLink("https://kaipu.app/auth/callback#token=abc")).toBeNull();
    expect(parseDeepLink("/Applications/Kaipu.app")).toBeNull();
    expect(parseDeepLink("kaipu:")).toEqual({ kind: "unhandled", path: "" });
  });
});

describe("findDeepLinkInArgv", () => {
  it("finds the link at the end of a packaged Windows command line", () => {
    const argv = [
      "C:\\Program Files\\Kaipu Record\\kaipu-record.exe",
      "kaipu:/auth/callback#token=x",
    ];
    expect(findDeepLinkInArgv(argv)).toBe("kaipu:/auth/callback#token=x");
  });

  it("finds it among the extra arguments of a dev launch", () => {
    const argv = ["electron", ".", "--inspect=5858", "kaipu:/auth/callback#token=x"];
    expect(findDeepLinkInArgv(argv)).toBe("kaipu:/auth/callback#token=x");
  });

  it("is null for a normal launch (cold start without a link)", () => {
    expect(
      findDeepLinkInArgv(["/Applications/Kaipu Record.app/Contents/MacOS/Kaipu Record"]),
    ).toBeNull();
    expect(findDeepLinkInArgv([])).toBeNull();
  });
});
