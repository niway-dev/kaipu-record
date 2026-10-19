import { DEFAULT_SIGNED_IN_PATH } from "./post-sign-in";

/**
 * Better Auth's session cookie: `better-auth.session_token`, with a `__Secure-` prefix over HTTPS
 * (the API sets `secure: true`). `session_data` (the cookie cache) is deliberately not matched:
 * only the token proves the browser has ever held a session.
 */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=/;

export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  return !!cookieHeader && SESSION_COOKIE.test(cookieHeader);
}

/**
 * Whether a visit to `/` should bounce to the dashboard.
 *
 * - No session cookie (every crawler, every first-time visitor): the landing renders and the
 *   session is never looked up, so the public page costs no API call.
 * - Cookie but no valid session (expired, revoked, or the lookup failed): the landing renders.
 *   Never a redirect to login and never a loop.
 * - Cookie and a valid session: the dashboard.
 */
export async function resolveHomeRedirect(input: {
  cookieHeader: string | null | undefined;
  hasValidSession: () => Promise<boolean>;
}): Promise<string | null> {
  if (!hasSessionCookie(input.cookieHeader)) return null;
  try {
    return (await input.hasValidSession()) ? DEFAULT_SIGNED_IN_PATH : null;
  } catch {
    return null;
  }
}
