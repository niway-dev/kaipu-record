/**
 * Cross-site request check for the cookie-authenticated `/api/v1` surface.
 *
 * Browser sessions travel as cookies, which the browser attaches on its own; the desktop app
 * authenticates with a bearer token and sends no cookie. So a state-changing request is
 * only a CSRF candidate when it carries a cookie. For those, the caller must prove it came
 * from one of our own origins.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CsrfOptions {
  /** Origins (scheme + host + port) allowed to send cookie-authenticated writes. */
  allowedOrigins: readonly string[];
}

function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    // Opaque origins serialize as "null".
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** Returns true when the request may proceed. */
export function isRequestAllowed(request: Request, options: CsrfOptions): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

  // No cookie means no ambient credential for a cross-site page to ride on
  // (bearer-token clients such as the desktop app land here).
  if (!request.headers.get("cookie")) return true;

  const origin = request.headers.get("origin");
  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    return options.allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized);
  }

  // Some same-origin requests omit Origin; fall back to Fetch Metadata.
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}
