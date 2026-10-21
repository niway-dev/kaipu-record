import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { hasSessionCookie } from "@/lib/home-redirect";

/**
 * Whether this request carries a Better Auth session cookie. Presence only, no session lookup and
 * no API call: the public nav uses it to offer "Dashboard" instead of "Sign in". A stale cookie
 * shows "Dashboard" and `/dashboard`'s own guard sends the visitor to login. The cookie is
 * httpOnly, so the browser cannot read it itself.
 */
export const getHasSessionCookie = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => hasSessionCookie(getRequestHeaders().get("cookie")),
);
