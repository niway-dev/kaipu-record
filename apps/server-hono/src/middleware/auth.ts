import { os, ORPCError } from "@orpc/server";
import { auth } from "../lib/auth";

export const authMiddleware = os
  .$context<{ headers: Headers }>()
  .middleware(async ({ context, next }) => {
    // No cookie cache here (NIW2-219, Q5): a session revoked by the Google pre-hijack guard (or
    // any revocation) must stop working on /api/v1 at once, not after the 10-minute cache.
    // Costs one session read per API call. Pages keep the cache for rendering.
    const session = await auth.api.getSession({
      headers: context.headers,
      query: { disableCookieCache: true },
    });

    if (!session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }

    return next({
      context: { user: session.user, session: session.session },
    });
  });
