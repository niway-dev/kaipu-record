import {
  MAX_PENDING_UPLOADS_PER_ACCOUNT,
  MAX_THUMBNAIL_BYTES,
  UPLOAD_TICKET_TTL_SECONDS,
  maxBytesForKind,
} from "@kaipu/domain/constants";
import type { ICloudAccessRepository, ICloudAssetRepository } from "@kaipu/domain/repositories";
import {
  AssetConflictError,
  CloudAccessDeniedError,
  FileTooLargeError,
  QuotaExceededError,
  TooManyPendingUploadsError,
  UnsupportedContentTypeError,
  UploadsDisabledError,
  buildRevisionStorageKey,
  buildThumbnailStorageKey,
  computeMissingBytes,
  isSupportedContentType,
  isValidUploadSize,
  toAssetSummary,
  UploadIntentExpiredError,
  type CloudAssetSummary,
  type CloudRevision,
  type CreateUploadIntent,
  type Entitlements,
} from "@kaipu/domain/schemas";
import type { IStorageService, UploadTicket } from "@kaipu/domain/services";

export interface UploadIntentResult {
  asset: CloudAssetSummary;
  revisionId: string;
  status: "reserved" | "ready";
  ticket: null | (UploadTicket & { thumbnail: null | Pick<UploadTicket, "url" | "headers"> });
}

/**
 * Reserve quota for one revision and hand back restricted tickets. Order matters:
 * every rule that needs no I/O runs first, then access/switch, then the
 * idempotency lookup, then the atomic reservation, and only then are tickets signed.
 */
export async function createUploadIntent(params: {
  assets: ICloudAssetRepository;
  access: ICloudAccessRepository;
  storage: IStorageService;
  userId: string;
  entitlements: Entitlements;
  input: CreateUploadIntent;
  now?: Date;
}): Promise<UploadIntentResult> {
  const { assets, access, storage, userId, entitlements, input } = params;
  const now = params.now ?? new Date();

  if (!isSupportedContentType(input.kind, input.contentType))
    throw new UnsupportedContentTypeError(input.contentType);
  if (!isValidUploadSize(input.kind, input.sizeBytes))
    throw new FileTooLargeError(maxBytesForKind(input.kind));
  if (input.thumbnail && input.thumbnail.sizeBytes > MAX_THUMBNAIL_BYTES)
    throw new FileTooLargeError(MAX_THUMBNAIL_BYTES);
  if (!entitlements.features.cloudUploads) throw new CloudAccessDeniedError();
  if (!(await access.getControl()).uploadsEnabled) throw new UploadsDisabledError();

  const existing = await assets.findByIntentKey(userId, input.intentKey);
  if (existing) return resume(existing);

  const revisionId = crypto.randomUUID();
  const storageKey = buildRevisionStorageKey({
    userId,
    assetId: input.assetId,
    revisionId,
    kind: input.kind,
    contentType: input.contentType,
  });
  const thumbnailKey = input.thumbnail
    ? buildThumbnailStorageKey({ userId, assetId: input.assetId, revisionId, kind: input.kind })
    : null;
  const thumbnailBytes = input.thumbnail?.sizeBytes ?? 0;
  const reservedBytes = input.sizeBytes + thumbnailBytes;

  let outcome;
  try {
    outcome = await assets.reserve({
      userId,
      assetId: input.assetId,
      intentKey: input.intentKey,
      revisionId,
      kind: input.kind,
      title: input.title,
      durationSeconds: input.durationSeconds,
      derivedFromAssetId: input.derivedFromAssetId,
      storageKey,
      thumbnailKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      thumbnailBytes,
      contentSha256: input.contentSha256,
      reservedBytes,
      ticketExpiresAt: new Date(now.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000),
      capacityBytes: entitlements.features.cloudStorageBytes,
      maxPending: MAX_PENDING_UPLOADS_PER_ACCOUNT,
    });
  } catch (err) {
    // A concurrent reserve for the same (user, intentKey) loses the race at the storage layer
    // and surfaces as AssetConflictError (never a raw DB error — infra maps that). The loser
    // did not write anything: resolve to whatever the winner created, the same as the
    // findByIntentKey fast path above would have. A tombstoned-asset conflict has no revision
    // to resume, so it rethrows.
    if (err instanceof AssetConflictError) {
      const winner = await assets.findByIntentKey(userId, input.intentKey);
      if (winner) return resume(winner);
    }
    throw err;
  }

  if (outcome.kind === "too-many-pending")
    throw new TooManyPendingUploadsError(MAX_PENDING_UPLOADS_PER_ACCOUNT);
  if (outcome.kind === "quota-exceeded") {
    throw new QuotaExceededError(
      computeMissingBytes(
        { capacityBytes: entitlements.features.cloudStorageBytes, ...outcome },
        reservedBytes,
      ),
    );
  }

  try {
    const ticket = await sign(outcome.revision, input.thumbnail?.contentSha256 ?? null);
    return { asset: toAssetSummary(outcome.asset, null), revisionId, status: "reserved", ticket };
  } catch (err) {
    // Signing failed after the bytes were reserved — give them back so a permanently
    // reserved revision never blocks the account. The intent key is free to retry.
    await assets.release(userId, revisionId).catch(() => undefined);
    throw err;
  }

  async function resume(revision: CloudRevision): Promise<UploadIntentResult> {
    const found = await assets.findAsset(userId, revision.assetId);
    if (!found) throw new Error("intent refers to a missing asset");
    if (revision.status === "ready") {
      return {
        asset: toAssetSummary(found.asset, revision),
        revisionId: revision.revisionId,
        status: "ready",
        ticket: null,
      };
    }
    if (revision.status !== "reserved") {
      // Expired (swept) or cancelled intent: the reservation is gone. Not a quota problem —
      // the client starts a new intent with a new key.
      throw new UploadIntentExpiredError();
    }
    const ticketExpiresAt = new Date(now.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000);
    const extended = await assets.extendTicket(userId, revision.revisionId, ticketExpiresAt);
    if (!extended) {
      // The sweep released this reservation between our lookup and the extend — there is
      // nothing left to hand a ticket for. Not a quota problem: start a new intent.
      throw new UploadIntentExpiredError();
    }
    const ticket = await sign(
      { ...revision, ticketExpiresAt },
      input.thumbnail?.contentSha256 ?? null,
    );
    return {
      asset: toAssetSummary(found.asset, null),
      revisionId: revision.revisionId,
      status: "reserved",
      ticket,
    };
  }

  async function sign(revision: CloudRevision, thumbnailSha256: string | null) {
    const main = await storage.createUploadTicket(revision.storageKey, {
      contentType: revision.contentType,
      contentLength: revision.sizeBytes,
      checksumSha256: revision.contentSha256,
      expiresInSeconds: UPLOAD_TICKET_TTL_SECONDS,
    });
    const thumbnail =
      revision.thumbnailKey && thumbnailSha256
        ? await storage.createUploadTicket(revision.thumbnailKey, {
            contentType: "image/jpeg",
            contentLength: revision.thumbnailBytes,
            checksumSha256: thumbnailSha256,
            expiresInSeconds: UPLOAD_TICKET_TTL_SECONDS,
          })
        : null;
    return {
      ...main,
      thumbnail: thumbnail ? { url: thumbnail.url, headers: thumbnail.headers } : null,
    };
  }
}
