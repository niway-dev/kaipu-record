import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { resolveHomeRedirect } from "@/lib/home-redirect";

/**
 * Where `/` should send this request, or null to render the landing. The decision itself lives in
 * `resolveHomeRedirect`; this only feeds it the request's cookie and the session lookup.
 */
export const getHomeRedirect = createServerFn({ method: "GET" }).handler(
  async (): Promise<string | null> =>
    resolveHomeRedirect({
      cookieHeader: getRequestHeaders().get("cookie"),
      hasValidSession: async () => (await getAuthSession()) !== null,
    }),
);
