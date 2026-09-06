import { getEntitlements } from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { SubscriptionRepository } from "@kaipu/infra-db/repositories";
import { implement } from "@orpc/server";
import { meContract } from "../../contract/me.contract";
import { env } from "../../env";
import { authMiddleware } from "../../middleware/auth";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new SubscriptionRepository(db);

const impl = implement(meContract).$context<{ headers: Headers }>();

export const meRouter = impl.router({
  // Identity comes from authMiddleware; billing from the subscription repo. This
  // route is where the two are composed — neither layer knows about the other.
  entitlements: impl.entitlements.use(authMiddleware).handler(async ({ context }) => {
    const data = await getEntitlements({ repo, userId: context.user.id });
    return { data, error: null };
  }),
});
