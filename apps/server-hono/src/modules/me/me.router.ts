import { getEntitlements, getStorageUsage } from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import {
  CloudAccessRepository,
  CloudAssetRepository,
  SubscriptionRepository,
} from "@kaipu/infra-db/repositories";
import { implement } from "@orpc/server";
import { meContract } from "../../contract/me.contract";
import { env } from "../../env";
import { authMiddleware } from "../../middleware/auth";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new SubscriptionRepository(db);
const cloudAccessRepo = new CloudAccessRepository(db);
const assets = new CloudAssetRepository(db);

const impl = implement(meContract).$context<{ headers: Headers }>();

export const meRouter = impl.router({
  // Identity comes from authMiddleware; billing from the subscription repo and cloud access
  // (verified email) from the cloud access repo. This route is where they are composed.
  entitlements: impl.entitlements.use(authMiddleware).handler(async ({ context }) => {
    const data = await getEntitlements({ repo, cloudAccessRepo, userId: context.user.id });
    return { data, error: null };
  }),
  storage: impl.storage.use(authMiddleware).handler(async ({ context }) => {
    const entitlements = await getEntitlements({ repo, cloudAccessRepo, userId: context.user.id });
    const data = await getStorageUsage({
      assets,
      access: cloudAccessRepo,
      userId: context.user.id,
      entitlements,
    });
    return { data, error: null };
  }),
});
