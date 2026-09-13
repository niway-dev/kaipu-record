import type {
  AccountUsage,
  AssetPage,
  ICloudAccessRepository,
  ICloudAssetRepository,
  ICloudPurgeRepository,
  PurgeJob,
  ReserveOutcome,
  ReserveRevisionData,
} from "@kaipu/domain/repositories";
import { AssetConflictError, type CloudAsset, type CloudRevision } from "@kaipu/domain/schemas";
import type {
  IStorageService,
  ObjectMetadata,
  UploadTicket,
  UploadTicketRequest,
} from "@kaipu/domain/services";

/** In-memory twin of CloudAssetRepository: same transitions, same counters, no SQL. */
export function makeFakeAssets(): ICloudAssetRepository & {
  assets: Map<string, CloudAsset>;
  revisions: Map<string, CloudRevision>;
  accounts: Map<string, AccountUsage>;
} {
  const assets = new Map<string, CloudAsset>();
  const revisions = new Map<string, CloudRevision>();
  const accounts = new Map<string, AccountUsage>();
  const key = (userId: string, assetId: string): string => `${userId}/${assetId}`;
  const account = (userId: string): AccountUsage => {
    let a = accounts.get(userId);
    if (!a) {
      a = { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };
      accounts.set(userId, a);
    }
    return a;
  };
  const flip = (
    userId: string,
    revisionId: string,
    from: CloudRevision["status"],
    to: CloudRevision["status"],
  ) => {
    const rev = revisions.get(revisionId);
    if (!rev || rev.userId !== userId || rev.status !== from) return null;
    const next = { ...rev, status: to, updatedAt: new Date() };
    revisions.set(revisionId, next);
    return next;
  };

  return {
    assets,
    revisions,
    accounts,
    async reserve(data: ReserveRevisionData): Promise<ReserveOutcome> {
      // Mirrors the real repository: a tombstoned asset never receives new revisions, and a
      // duplicate (user, intentKey) surfaces as AssetConflictError, not a raw DB error. Neither
      // path writes anything.
      const existingAsset = assets.get(key(data.userId, data.assetId));
      if (existingAsset?.deletedAt) {
        throw new AssetConflictError(
          "The cloud asset was deleted; it cannot receive new revisions",
        );
      }
      const duplicateIntent = [...revisions.values()].some(
        (r) => r.userId === data.userId && r.intentKey === data.intentKey,
      );
      if (duplicateIntent) {
        throw new AssetConflictError("An upload intent with this key already exists");
      }

      const a = account(data.userId);
      if (a.pendingUploads >= data.maxPending) return { kind: "too-many-pending" };
      if (a.usedBytes + a.reservedBytes + data.reservedBytes > data.capacityBytes) {
        return { kind: "quota-exceeded", usedBytes: a.usedBytes, reservedBytes: a.reservedBytes };
      }
      a.reservedBytes += data.reservedBytes;
      a.pendingUploads += 1;
      const now = new Date();
      const existing = assets.get(key(data.userId, data.assetId));
      const asset: CloudAsset = existing
        ? {
            ...existing,
            title: data.title,
            durationSeconds: data.durationSeconds,
            deletedAt: null,
            updatedAt: now,
          }
        : {
            assetId: data.assetId,
            userId: data.userId,
            kind: data.kind,
            title: data.title,
            currentRevisionId: null,
            durationSeconds: data.durationSeconds,
            derivedFromAssetId: data.derivedFromAssetId,
            autoUploadExcluded: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
      assets.set(key(data.userId, data.assetId), asset);
      const revision: CloudRevision = {
        revisionId: data.revisionId,
        assetId: data.assetId,
        userId: data.userId,
        intentKey: data.intentKey,
        status: "reserved",
        storageKey: data.storageKey,
        thumbnailKey: data.thumbnailKey,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
        thumbnailBytes: data.thumbnailBytes,
        contentSha256: data.contentSha256,
        reservedBytes: data.reservedBytes,
        ticketExpiresAt: data.ticketExpiresAt,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      revisions.set(data.revisionId, revision);
      return { kind: "reserved", asset, revision };
    },
    async findByIntentKey(userId, intentKey) {
      return (
        [...revisions.values()].find((r) => r.userId === userId && r.intentKey === intentKey) ??
        null
      );
    },
    async findRevision(userId, assetId, revisionId) {
      const r = revisions.get(revisionId);
      return r && r.userId === userId && r.assetId === assetId ? r : null;
    },
    async findAsset(userId, assetId) {
      const asset = assets.get(key(userId, assetId));
      if (!asset) return null;
      const current = asset.currentRevisionId
        ? (revisions.get(asset.currentRevisionId) ?? null)
        : null;
      return { asset, current };
    },
    async extendTicket(userId, revisionId, ticketExpiresAt) {
      const r = revisions.get(revisionId);
      if (r && r.userId === userId && r.status === "reserved")
        revisions.set(revisionId, { ...r, ticketExpiresAt });
    },
    async markReady(userId, revisionId, verifiedAt) {
      const flipped = flip(userId, revisionId, "reserved", "ready");
      if (!flipped) {
        const r = revisions.get(revisionId);
        return r && r.userId === userId && r.status === "ready" ? r : null;
      }
      const ready = { ...flipped, verifiedAt };
      revisions.set(revisionId, ready);
      const a = account(userId);
      a.usedBytes += ready.reservedBytes;
      a.reservedBytes = Math.max(0, a.reservedBytes - ready.reservedBytes);
      a.pendingUploads = Math.max(0, a.pendingUploads - 1);
      const asset = assets.get(key(userId, ready.assetId));
      if (asset)
        assets.set(key(userId, ready.assetId), {
          ...asset,
          currentRevisionId: revisionId,
          deletedAt: null,
        });
      return ready;
    },
    async release(userId, revisionId) {
      const flipped = flip(userId, revisionId, "reserved", "expired");
      if (!flipped) return null;
      const a = account(userId);
      a.reservedBytes = Math.max(0, a.reservedBytes - flipped.reservedBytes);
      a.pendingUploads = Math.max(0, a.pendingUploads - 1);
      return flipped;
    },
    async beginDelete(userId, revisionId) {
      const flipped = flip(userId, revisionId, "ready", "deleting");
      if (!flipped) return null;
      const asset = assets.get(key(userId, flipped.assetId));
      if (asset && asset.currentRevisionId === revisionId) {
        assets.set(key(userId, flipped.assetId), {
          ...asset,
          currentRevisionId: null,
          autoUploadExcluded: true,
        });
      }
      return flipped;
    },
    async finishDelete(userId, revisionId) {
      const flipped = flip(userId, revisionId, "deleting", "deleted");
      if (!flipped) return null;
      const a = account(userId);
      a.usedBytes = Math.max(0, a.usedBytes - flipped.reservedBytes);
      return flipped;
    },
    async setAutoUploadExcluded(userId, assetId, excluded) {
      const asset = assets.get(key(userId, assetId));
      if (!asset) return null;
      const next = { ...asset, autoUploadExcluded: excluded };
      assets.set(key(userId, assetId), next);
      return next;
    },
    async listAssets(userId, params): Promise<AssetPage> {
      const all = [...assets.values()]
        .filter((a) => a.userId === userId && a.currentRevisionId)
        .sort(
          (x, y) =>
            y.createdAt.getTime() - x.createdAt.getTime() || (y.assetId < x.assetId ? -1 : 1),
        );
      const start = params.cursor ? Number(params.cursor) : 0;
      const page = all.slice(start, start + params.limit);
      return {
        items: page.map((a) => ({
          asset: a,
          current: revisions.get(a.currentRevisionId ?? "") ?? null,
        })),
        nextCursor: start + params.limit < all.length ? String(start + params.limit) : null,
      };
    },
    async usage(userId) {
      return { ...account(userId) };
    },
    async reconcile(userId) {
      const mine = [...revisions.values()].filter((r) => r.userId === userId);
      const usage = {
        usedBytes: mine
          .filter((r) => r.status === "ready" || r.status === "deleting")
          .reduce((s, r) => s + r.reservedBytes, 0),
        reservedBytes: mine
          .filter((r) => r.status === "reserved")
          .reduce((s, r) => s + r.reservedBytes, 0),
        pendingUploads: mine.filter((r) => r.status === "reserved").length,
      };
      accounts.set(userId, usage);
      return { ...usage };
    },
    async listReservedExpiredBefore(before, limit) {
      return [...revisions.values()]
        .filter((r) => r.status === "reserved" && r.ticketExpiresAt < before)
        .slice(0, limit);
    },
    async listDeleting(limit) {
      return [...revisions.values()].filter((r) => r.status === "deleting").slice(0, limit);
    },
    async listAccountsTouchedSince() {
      return [...accounts.keys()];
    },
  };
}

export function makeFakeAccess(
  opts: { access?: Set<string>; uploadsEnabled?: boolean } = {},
): ICloudAccessRepository & {
  uploadsEnabled: boolean;
} {
  const state = { uploadsEnabled: opts.uploadsEnabled ?? true };
  return Object.assign(state, {
    async hasAccess(userId: string) {
      return opts.access?.has(userId) ?? true;
    },
    async getControl() {
      return { uploadsEnabled: state.uploadsEnabled };
    },
  });
}

export function makeFakePurge(): ICloudPurgeRepository & {
  jobs: PurgeJob[];
  done: string[];
  errors: string[];
} {
  const state = { jobs: [] as PurgeJob[], done: [] as string[], errors: [] as string[] };
  return Object.assign(state, {
    async enqueue(userId: string) {
      state.jobs.push({ id: crypto.randomUUID(), userId, attempts: 0, createdAt: new Date() });
    },
    async nextPending(limit: number) {
      return state.jobs.filter((j) => !state.done.includes(j.id)).slice(0, limit);
    },
    async markAttempt(id: string, error: string | null) {
      const job = state.jobs.find((j) => j.id === id);
      if (job) job.attempts += 1;
      if (error) state.errors.push(error);
    },
    async markDone(id: string) {
      state.done.push(id);
    },
  });
}

/**
 * Fake object store. `objects` models what actually landed: tests "upload" by
 * calling `land(key, metadata)`, never by presigning.
 */
export function makeFakeStorage(): IStorageService & {
  objects: Map<string, ObjectMetadata>;
  tickets: string[];
  downloads: string[];
  deletes: string[];
  failDeletes: boolean;
  land(key: string, meta: Partial<ObjectMetadata> & { sizeBytes: number }): void;
} {
  const state = {
    objects: new Map<string, ObjectMetadata>(),
    tickets: [] as string[],
    downloads: [] as string[],
    deletes: [] as string[],
    failDeletes: false,
  };
  return Object.assign(state, {
    land(key: string, meta: Partial<ObjectMetadata> & { sizeBytes: number }) {
      state.objects.set(key, { contentType: null, etag: null, checksumSha256: null, ...meta });
    },
    async createUploadUrl(key: string) {
      state.tickets.push(key);
      return `https://r2.example/${key}?sig=legacy`;
    },
    async createUploadTicket(key: string, request: UploadTicketRequest): Promise<UploadTicket> {
      state.tickets.push(key);
      return {
        url: `https://r2.example/${key}?sig=up`,
        headers: {
          "content-type": request.contentType,
          "content-length": String(request.contentLength),
          "if-none-match": "*",
          "x-amz-checksum-sha256": request.checksumSha256,
        },
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      };
    },
    async createDownloadUrl(key: string) {
      state.downloads.push(key);
      return `https://r2.example/${key}?sig=down`;
    },
    async objectExists(key: string) {
      return state.objects.has(key);
    },
    async headObject(key: string) {
      return state.objects.get(key) ?? null;
    },
    async deleteObject(key: string) {
      if (state.failDeletes) throw new Error("R2 delete failed");
      state.deletes.push(key);
      state.objects.delete(key);
    },
    async listObjectKeys(prefix: string) {
      return {
        keys: [...state.objects.keys()].filter((k) => k.startsWith(prefix)),
        nextCursor: null,
      };
    },
  });
}
