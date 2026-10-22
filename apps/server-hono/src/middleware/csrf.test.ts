import { describe, expect, it } from "vitest";
import { isRequestAllowed } from "./csrf";

const options = { allowedOrigins: ["https://kaipu.app", "http://localhost:3001/"] };

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request("https://api.test/api/v1/assets", { method, headers });
}

describe("isRequestAllowed", () => {
  it("allows safe methods regardless of origin", () => {
    expect(
      isRequestAllowed(req("GET", { cookie: "s=1", origin: "https://evil.example" }), options),
    ).toBe(true);
  });

  it("allows cookie-less (bearer) writes from any caller", () => {
    const bearer = { authorization: "Bearer t", origin: "kaipu-record://app" };
    expect(isRequestAllowed(req("POST", bearer), options)).toBe(true);
    expect(isRequestAllowed(req("POST"), options)).toBe(true);
  });

  it("allows cookie writes from an allowed origin", () => {
    expect(
      isRequestAllowed(req("POST", { cookie: "s=1", origin: "https://kaipu.app" }), options),
    ).toBe(true);
    expect(
      isRequestAllowed(req("DELETE", { cookie: "s=1", origin: "http://localhost:3001" }), options),
    ).toBe(true);
  });

  it("rejects cookie writes from another origin", () => {
    for (const origin of ["https://evil.example", "null", "https://kaipu.app.evil.example"]) {
      expect(isRequestAllowed(req("POST", { cookie: "s=1", origin }), options)).toBe(false);
    }
  });

  it("normalizes the Origin header before comparing it", () => {
    for (const origin of ["https://kaipu.app:443", "https://KAIPU.app", "https://kaipu.app/"]) {
      expect(isRequestAllowed(req("POST", { cookie: "s=1", origin }), options), origin).toBe(true);
    }
    // Userinfo tricks resolve to the real host and are rejected.
    expect(
      isRequestAllowed(
        req("POST", { cookie: "s=1", origin: "https://kaipu.app@evil.example" }),
        options,
      ),
    ).toBe(false);
  });

  it("checks lowercase methods the Fetch spec does not normalize", () => {
    expect(
      isRequestAllowed(req("patch", { cookie: "s=1", origin: "https://evil.example" }), options),
    ).toBe(false);
  });

  it("treats a custom-scheme or wildcard allow-list entry as never matching", () => {
    const custom = { allowedOrigins: ["kaipu-record://app", "https://*.kaipu.app"] };
    expect(
      isRequestAllowed(req("POST", { cookie: "s=1", origin: "kaipu-record://app" }), custom),
    ).toBe(false);
    expect(
      isRequestAllowed(req("POST", { cookie: "s=1", origin: "https://www.kaipu.app" }), custom),
    ).toBe(false);
  });

  it("falls back to Sec-Fetch-Site when Origin is absent", () => {
    const c = { cookie: "s=1" };
    expect(isRequestAllowed(req("POST", { ...c, "sec-fetch-site": "same-origin" }), options)).toBe(
      true,
    );
    expect(isRequestAllowed(req("POST", { ...c, "sec-fetch-site": "cross-site" }), options)).toBe(
      false,
    );
    expect(isRequestAllowed(req("POST", { ...c, "sec-fetch-site": "same-site" }), options)).toBe(
      false,
    );
    expect(isRequestAllowed(req("POST", c), options)).toBe(false);
  });
});
