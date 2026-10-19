import { describe, expect, it, vi } from "vitest";
import { hasSessionCookie, resolveHomeRedirect } from "./home-redirect";

const TOKEN = "better-auth.session_token=abc.def";

describe("hasSessionCookie", () => {
  it("recognises the plain and the HTTPS-prefixed token among other cookies", () => {
    expect(hasSessionCookie(TOKEN)).toBe(true);
    expect(hasSessionCookie(`theme=dark; __Secure-${TOKEN}; locale=es`)).toBe(true);
  });

  it("ignores everything else", () => {
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("theme=dark; locale=es")).toBe(false);
    expect(hasSessionCookie("better-auth.session_data=xyz")).toBe(false);
    expect(hasSessionCookie("x-better-auth.session_token=abc")).toBe(false);
  });
});

describe("resolveHomeRedirect", () => {
  it("renders the landing without looking up the session when there is no cookie", async () => {
    const hasValidSession = vi.fn().mockResolvedValue(true);
    expect(await resolveHomeRedirect({ cookieHeader: "theme=dark", hasValidSession })).toBeNull();
    expect(await resolveHomeRedirect({ cookieHeader: undefined, hasValidSession })).toBeNull();
    expect(hasValidSession).not.toHaveBeenCalled();
  });

  it("goes to the dashboard for a valid session", async () => {
    const hasValidSession = vi.fn().mockResolvedValue(true);
    expect(await resolveHomeRedirect({ cookieHeader: TOKEN, hasValidSession })).toBe("/dashboard");
    expect(hasValidSession).toHaveBeenCalledOnce();
  });

  it("renders the landing when the cookie's session is invalid, or the lookup fails", async () => {
    const invalid = vi.fn().mockResolvedValue(false);
    expect(await resolveHomeRedirect({ cookieHeader: TOKEN, hasValidSession: invalid })).toBeNull();
    const failing = vi.fn().mockRejectedValue(new Error("api down"));
    expect(await resolveHomeRedirect({ cookieHeader: TOKEN, hasValidSession: failing })).toBeNull();
  });
});
