import { expect, it } from "vitest";
import { withSecurityHeaders } from "@kaipu/infra-cloudflare";

it("sets the hardening headers and a framing-proof CSP on documents", () => {
  const res = withSecurityHeaders(
    new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
  );
  const h = res.headers;
  expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(h.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  expect(h.get("x-frame-options")).toBe("DENY");
  expect(h.get("x-content-type-options")).toBe("nosniff");
  expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(h.get("permissions-policy")).toContain("camera=()");
});
