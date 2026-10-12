/**
 * Browser security headers for the Workers that serve HTML (web, console).
 *
 * Implemented in code (a request middleware in each app) rather than as a dashboard
 * rule so the policy is reviewed, versioned and testable.
 *
 * CSP note: TanStack Start inlines its hydration/bootstrap scripts into the document and
 * React emits `style` attributes, so `script-src` and `style-src` keep `'unsafe-inline'`.
 * Everything else is locked to the origin; `object-src`, `base-uri`, `form-action` and
 * `frame-ancestors` close the remaining injection and framing paths. Moving scripts to
 * per-request nonces is possible later via the router's `ssr.nonce` option.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers added to every response (documents and API proxies alike). */
export const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Returns a copy of `response` carrying the security headers. The CSP is only attached to
 * documents (`text/html`); it is meaningless on JSON/asset responses.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) headers.set(name, value);
  if ((headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
