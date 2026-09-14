import {
  cancelUpload,
  confirmUpload,
  createUploadIntent,
  deleteCloudCopy,
  getAssetDownloadUrl,
  getEntitlements,
  listCloudAssets,
  setAutoUploadExclusion,
} from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import {
  CloudAccessRepository,
  CloudAssetRepository,
  SubscriptionRepository,
} from "@kaipu/infra-db/repositories";
import { QuotaExceededError, toAssetSummary } from "@kaipu/domain/schemas";
import { implement, ORPCError } from "@orpc/server";
import { cloudContract } from "../../contract/cloud.contract";
import { env } from "../../env";
import { logEvent } from "../../lib/events";
import { getStorage } from "../../lib/storage";
import { authMiddleware } from "../../middleware/auth";
import { toOrpcError } from "./errors";

const db = createDatabaseClient(env.DATABASE_URL);
const assets = new CloudAssetRepository(db);
const access = new CloudAccessRepository(db);
const subscriptions = new SubscriptionRepository(db);

const impl = implement(cloudContract).$context<{ headers: Headers }>();

const notFound = (): never => {
  throw new ORPCError("NOT_FOUND", { message: "Asset not found" });
};

export const cloudRouter = impl.router({
  createUploadIntent: impl.createUploadIntent
    .use(authMiddleware)
    .handler(async ({ input, context }) => {
      const userId = context.user.id;
      try {
        const entitlements = await getEntitlements({
          repo: subscriptions,
          cloudAccessRepo: access,
          userId,
        });
        const data = await createUploadIntent({
          assets,
          access,
          storage: getStorage(),
          userId,
          entitlements,
          input,
        });
        logEvent({
          name: "cloud.intent.created",
          userId,
          assetId: input.assetId,
          revisionId: data.revisionId,
          reservedBytes: input.sizeBytes + (input.thumbnail?.sizeBytes ?? 0),
        });
        return { data, error: null };
      } catch (err) {
        logEvent({
          name: "cloud.intent.rejected",
          userId,
          reason: err instanceof Error ? err.name : "unknown",
          missingBytes: err instanceof QuotaExceededError ? err.missingBytes : undefined,
        });
        throw toOrpcError(err);
      }
    }),

  confirmUpload: impl.confirmUpload.use(authMiddleware).handler(async ({ input, context }) => {
    const userId = context.user.id;
    try {
      const data = await confirmUpload({
        assets,
        storage: getStorage(),
        userId,
        assetId: input.assetId,
        revisionId: input.revisionId,
      });
      if (!data) return notFound();
      logEvent({
        name: "cloud.confirm.ok",
        userId,
        revisionId: input.revisionId,
        sizeBytes: data.sizeBytes ?? 0,
      });
      return { data, error: null };
    } catch (err) {
      logEvent({
        name: "cloud.confirm.failed",
        userId,
        revisionId: input.revisionId,
        reason: err instanceof Error ? err.name : "unknown",
      });
      throw toOrpcError(err);
    }
  }),

  cancelUpload: impl.cancelUpload.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await cancelUpload({
      assets,
      storage: getStorage(),
      userId: context.user.id,
      assetId: input.assetId,
      revisionId: input.revisionId,
    });
    if (!data) return notFound();
    return { data, error: null };
  }),

  list: impl.list.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await listCloudAssets({
      assets,
      userId: context.user.id,
      cursor: input.cursor ?? null,
      limit: input.limit,
    });
    return { data, error: null };
  }),

  get: impl.get.use(authMiddleware).handler(async ({ input, context }) => {
    const found = await assets.findAsset(context.user.id, input.assetId);
    if (!found) return notFound();
    return { data: toAssetSummary(found.asset, found.current), error: null };
  }),

  downloadUrl: impl.downloadUrl.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await getAssetDownloadUrl({
      assets,
      storage: getStorage(),
      userId: context.user.id,
      assetId: input.assetId,
    });
    if (!data) return notFound();
    return { data, error: null };
  }),

  deleteCloudCopy: impl.deleteCloudCopy.use(authMiddleware).handler(async ({ input, context }) => {
    const userId = context.user.id;
    try {
      const data = await deleteCloudCopy({
        assets,
        storage: getStorage(),
        userId,
        assetId: input.assetId,
      });
      if (!data) return notFound();
      logEvent({ name: "cloud.delete.ok", userId, assetId: input.assetId });
      return { data: { deleted: data.deleted }, error: null };
    } catch (err) {
      logEvent({
        name: "cloud.delete.failed",
        userId,
        assetId: input.assetId,
        error: err instanceof Error ? err.name : "unknown",
      });
      throw err;
    }
  }),

  setAutoUploadExclusion: impl.setAutoUploadExclusion
    .use(authMiddleware)
    .handler(async ({ input, context }) => {
      const data = await setAutoUploadExclusion({
        assets,
        userId: context.user.id,
        assetId: input.assetId,
        excluded: input.excluded,
      });
      if (!data) return notFound();
      return { data, error: null };
    }),
});
