import { describe, expect, it } from "vitest";
import { createProxyHandler, withSecurityHeaders } from "@kaipu/infra-cloudflare";

describe("withSecurityHeaders", () => {
  const html = () =>
    withSecurityHeaders(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );

  it("sets the hardening headers on documents", () => {
    const h = html().headers;
    expect(h.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("permissions-policy")).toContain("camera=()");
    expect(h.get("permissions-policy")).toContain("microphone=()");
    expect(h.get("permissions-policy")).toContain("geolocation=()");
  });

  it("sends a CSP that forbids framing and plugins on documents", () => {
    const csp = html().headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("skips the CSP on non-HTML responses but keeps the other headers", () => {
    const res = withSecurityHeaders(Response.json({ ok: true }));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.status).toBe(200);
  });
});

describe("createProxyHandler", () => {
  const make = (opts: { forwardedHeaders?: boolean; allowedPathPrefixes?: string[] }) => {
    const seen: Request[] = [];
    const handler = createProxyHandler({
      backendUrl: "http://backend",
      fetchFn: async (req) => {
        seen.push(req);
        return new Response("ok");
      },
      ...opts,
    });
    return { handler, seen };
  };
  const spoofed = () =>
    new Request("https://kaipu.app/api/v1/x", {
      headers: {
        "x-forwarded-host": "evil.test",
        "x-forwarded-proto": "http",
        "x-forwarded-for": "1.2.3.4",
        forwarded: "for=1.2.3.4",
      },
    });

  it("strips client-sent forwarding headers when not forwarding", async () => {
    const { handler, seen } = make({});
    await handler(spoofed());
    const h = seen[0]!.headers;
    expect(h.get("x-forwarded-host")).toBeNull();
    expect(h.get("x-forwarded-for")).toBeNull();
    expect(h.get("forwarded")).toBeNull();
  });

  it("overwrites host/proto with the observed values when forwarding", async () => {
    const { handler, seen } = make({ forwardedHeaders: true });
    await handler(spoofed());
    const h = seen[0]!.headers;
    expect(h.get("x-forwarded-host")).toBe("kaipu.app");
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("x-forwarded-for")).toBeNull();
  });

  it("404s paths outside the allowed prefixes", async () => {
    const { handler, seen } = make({ allowedPathPrefixes: ["/api/v1/"] });
    const res = await handler(new Request("https://kaipu.app/internal/admin"));
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});
