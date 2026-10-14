import {
  getAccountDeletionStatus,
  getEntitlements,
  getStorageUsage,
  requestAccountDeletion,
  restoreAccount,
} from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import {
  AccountDeletionRepository,
  CloudAccessRepository,
  CloudAssetRepository,
  SubscriptionRepository,
} from "@kaipu/infra-db/repositories";
import { implement } from "@orpc/server";
import { meContract } from "../../contract/me.contract";
import { env } from "../../env";
import { assertFreshSession } from "../../account/account-guard";
import { makeAccountDeletionNotifier } from "../../lib/account-deletion-notifier";
import { emailLocale } from "../../lib/email";
import { authAllowingScheduledDeletionMiddleware, authMiddleware } from "../../middleware/auth";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new SubscriptionRepository(db);
const cloudAccessRepo = new CloudAccessRepository(db);
const assets = new CloudAssetRepository(db);
const deletions = new AccountDeletionRepository(db);
const notifier = makeAccountDeletionNotifier();

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
  accountDeletionStatus: impl.accountDeletionStatus
    .use(authAllowingScheduledDeletionMiddleware)
    .handler(async ({ context }) => {
      const data = await getAccountDeletionStatus({ deletions, userId: context.user.id });
      return { data, error: null };
    }),
  // Deactivates the account, revokes every session (this one included) and emails the date.
  // No R2 call here: the cron purges after the grace period, a bounded batch per tick.
  requestAccountDeletion: impl.requestAccountDeletion
    .use(authAllowingScheduledDeletionMiddleware)
    .handler(async ({ context }) => {
      const now = new Date();
      assertFreshSession(new Date(context.session.createdAt), now);
      const data = await requestAccountDeletion({
        deletions,
        notifier,
        user: { id: context.user.id, email: context.user.email },
        locale: emailLocale(context),
        now,
      });
      return { data, error: null };
    }),
  restoreAccount: impl.restoreAccount
    .use(authAllowingScheduledDeletionMiddleware)
    .handler(async ({ context }) => {
      await restoreAccount({ deletions, userId: context.user.id });
      const data = await getAccountDeletionStatus({ deletions, userId: context.user.id });
      return { data, error: null };
    }),
});
