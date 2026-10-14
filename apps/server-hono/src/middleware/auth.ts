import { createDatabaseClient } from "@kaipu/infra-db/client";
import { AccountDeletionRepository } from "@kaipu/infra-db/repositories";
import { os, ORPCError } from "@orpc/server";
import { assertAccountActive } from "../account/account-guard";
import { env } from "../env";
import { auth } from "../lib/auth";

const deletions = new AccountDeletionRepository(createDatabaseClient(env.DATABASE_URL));

/**
 * Every authenticated route. Refuses accounts scheduled for deletion (soft delete, NIW2-214):
 * a session created during the grace period can only reach the account-deletion routes.
 */
export const authMiddleware = os
  .$context<{ headers: Headers }>()
  .middleware(async ({ context, next }) => {
    const session = await auth.api.getSession({ headers: context.headers });

    if (!session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }
    assertAccountActive(await deletions.find(session.user.id));

    return next({
      context: { user: session.user, session: session.session },
    });
  });

/**
 * Only for `/me/account-deletion*` (status, request, restore): lets a deactivated account in.
 * Bypasses Better Auth's 10-minute cookie cache so a session revoked by the deletion request is
 * really gone — the cached cookie must not be able to restore the account.
 */
export const authAllowingScheduledDeletionMiddleware = os
  .$context<{ headers: Headers }>()
  .middleware(async ({ context, next }) => {
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
