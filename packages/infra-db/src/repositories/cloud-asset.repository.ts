import type {
  AccountUsage,
  AssetPage,
  ICloudAssetRepository,
  ReserveOutcome,
  ReserveRevisionData,
} from "@kaipu/domain/repositories";
import type { CloudAsset, CloudRevision } from "@kaipu/domain/schemas";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { mapCloudAssetToDomain, mapCloudRevisionToDomain } from "../mappers/cloud.mapper";
import { cloudAssetTable, cloudRevisionTable, cloudStorageAccountTable } from "../schema/cloud";

/** Keyset cursor: "<createdAtMillis>:<assetId>", opaque to clients. */
function encodeCursor(createdAt: Date, assetId: string): string {
  return Buffer.from(`${createdAt.getTime()}:${assetId}`).toString("base64url");
}
function decodeCursor(cursor: string): { createdAt: Date; assetId: string } | null {
  const raw = Buffer.from(cursor, "base64url").toString();
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  const ms = Number(raw.slice(0, sep));
  if (!Number.isFinite(ms)) return null;
  return { createdAt: new Date(ms), assetId: raw.slice(sep + 1) };
}

export class CloudAssetRepository implements ICloudAssetRepository {
  constructor(private db: DatabaseClient) {}

  async reserve(data: ReserveRevisionData): Promise<ReserveOutcome> {
    // 1. Make sure the accounting row exists (idempotent).
    await this.db
      .insert(cloudStorageAccountTable)
      .values({ userId: data.userId })
      .onConflictDoNothing();

    // 2. THE quota check. One conditional UPDATE: Postgres takes the row lock, a
    //    concurrent reserve re-evaluates the WHERE after this commits, so two requests
    //    for the last bytes can never both pass. Also enforces the pending cap.
    const [account] = await this.db
      .update(cloudStorageAccountTable)
      .set({
        reservedBytes: sql`${cloudStorageAccountTable.reservedBytes} + ${data.reservedBytes}`,
        pendingUploads: sql`${cloudStorageAccountTable.pendingUploads} + 1`,
      })
      .where(
        and(
          eq(cloudStorageAccountTable.userId, data.userId),
          sql`${cloudStorageAccountTable.usedBytes} + ${cloudStorageAccountTable.reservedBytes} + ${data.reservedBytes} <= ${data.capacityBytes}`,
          sql`${cloudStorageAccountTable.pendingUploads} < ${data.maxPending}`,
        ),
      )
      .returning();

    if (!account) {
      const current = await this.usage(data.userId);
      if (current.pendingUploads >= data.maxPending) return { kind: "too-many-pending" };
      return {
        kind: "quota-exceeded",
        usedBytes: current.usedBytes,
        reservedBytes: current.reservedBytes,
      };
    }

    // 3. Upsert the asset and insert the revision. If either fails, give the bytes back;
    //    if the process dies in between, `reconcile()` (sweep) rebuilds the counters.
    try {
      const [assetRow] = await this.db
        .insert(cloudAssetTable)
        .values({
          userId: data.userId,
          assetId: data.assetId,
          kind: data.kind,
          title: data.title,
          durationSeconds: data.durationSeconds,
          derivedFromAssetId: data.derivedFromAssetId,
        })
        .onConflictDoUpdate({
          target: [cloudAssetTable.userId, cloudAssetTable.assetId],
          set: { title: data.title, durationSeconds: data.durationSeconds, deletedAt: null },
        })
        .returning();
      const [revisionRow] = await this.db
        .insert(cloudRevisionTable)
        .values({
          revisionId: data.revisionId,
          userId: data.userId,
          assetId: data.assetId,
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
        })
        .returning();
      if (!assetRow || !revisionRow) throw new Error("reserve: insert returned no row");
      return {
        kind: "reserved",
        asset: mapCloudAssetToDomain(assetRow),
        revision: mapCloudRevisionToDomain(revisionRow),
      };
    } catch (err) {
      await this.adjust(data.userId, { reservedBytes: -data.reservedBytes, pendingUploads: -1 });
      throw err;
    }
  }

  /** Bounded counter arithmetic — never lets a counter drop below zero. */
  private async adjust(
    userId: string,
    delta: { usedBytes?: number; reservedBytes?: number; pendingUploads?: number },
  ): Promise<void> {
    await this.db
      .update(cloudStorageAccountTable)
      .set({
        usedBytes: sql`greatest(0, ${cloudStorageAccountTable.usedBytes} + ${delta.usedBytes ?? 0})`,
        reservedBytes: sql`greatest(0, ${cloudStorageAccountTable.reservedBytes} + ${delta.reservedBytes ?? 0})`,
        pendingUploads: sql`greatest(0, ${cloudStorageAccountTable.pendingUploads} + ${delta.pendingUploads ?? 0})`,
      })
      .where(eq(cloudStorageAccountTable.userId, userId));
  }

  async findByIntentKey(userId: string, intentKey: string): Promise<CloudRevision | null> {
    const [row] = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(
        and(eq(cloudRevisionTable.userId, userId), eq(cloudRevisionTable.intentKey, intentKey)),
      )
      .limit(1);
    return row ? mapCloudRevisionToDomain(row) : null;
  }

  async findRevision(
    userId: string,
    assetId: string,
    revisionId: string,
  ): Promise<CloudRevision | null> {
    const [row] = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(
        and(
          eq(cloudRevisionTable.userId, userId),
          eq(cloudRevisionTable.assetId, assetId),
          eq(cloudRevisionTable.revisionId, revisionId),
        ),
      )
      .limit(1);
    return row ? mapCloudRevisionToDomain(row) : null;
  }

  async findAsset(userId: string, assetId: string) {
    const [assetRow] = await this.db
      .select()
      .from(cloudAssetTable)
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, assetId)))
      .limit(1);
    if (!assetRow) return null;
    const asset = mapCloudAssetToDomain(assetRow);
    const current = asset.currentRevisionId
      ? await this.findRevision(userId, assetId, asset.currentRevisionId)
      : null;
    return { asset, current };
  }

  async extendTicket(userId: string, revisionId: string, ticketExpiresAt: Date): Promise<void> {
    await this.db
      .update(cloudRevisionTable)
      .set({ ticketExpiresAt })
      .where(
        and(
          eq(cloudRevisionTable.userId, userId),
          eq(cloudRevisionTable.revisionId, revisionId),
          eq(cloudRevisionTable.status, "reserved"),
        ),
      );
  }

  /** Transition helper: flips status only from `from`; returns null when the row was not in `from`. */
  private async transition(
    userId: string,
    revisionId: string,
    from: CloudRevision["status"],
    to: CloudRevision["status"],
    extra: Partial<typeof cloudRevisionTable.$inferInsert> = {},
  ): Promise<CloudRevision | null> {
    const [row] = await this.db
      .update(cloudRevisionTable)
      .set({ status: to, ...extra })
      .where(
        and(
          eq(cloudRevisionTable.userId, userId),
          eq(cloudRevisionTable.revisionId, revisionId),
          eq(cloudRevisionTable.status, from),
        ),
      )
      .returning();
    return row ? mapCloudRevisionToDomain(row) : null;
  }

  async markReady(
    userId: string,
    revisionId: string,
    verifiedAt: Date,
  ): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "reserved", "ready", { verifiedAt });
    if (!flipped) {
      // Already ready (idempotent confirm) or not confirmable — report the row as-is, count nothing.
      const [row] = await this.db
        .select()
        .from(cloudRevisionTable)
        .where(
          and(eq(cloudRevisionTable.userId, userId), eq(cloudRevisionTable.revisionId, revisionId)),
        )
        .limit(1);
      return row && row.status === "ready" ? mapCloudRevisionToDomain(row) : null;
    }
    await this.adjust(userId, {
      usedBytes: flipped.reservedBytes,
      reservedBytes: -flipped.reservedBytes,
      pendingUploads: -1,
    });
    await this.db
      .update(cloudAssetTable)
      .set({ currentRevisionId: revisionId, deletedAt: null })
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, flipped.assetId)));
    return flipped;
  }

  async release(userId: string, revisionId: string): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "reserved", "expired");
    if (!flipped) return null;
    await this.adjust(userId, { reservedBytes: -flipped.reservedBytes, pendingUploads: -1 });
    return flipped;
  }

  async beginDelete(userId: string, revisionId: string): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "ready", "deleting");
    if (!flipped) return null;
    await this.db
      .update(cloudAssetTable)
      .set({ currentRevisionId: null, autoUploadExcluded: true })
      .where(
        and(
          eq(cloudAssetTable.userId, userId),
          eq(cloudAssetTable.assetId, flipped.assetId),
          eq(cloudAssetTable.currentRevisionId, revisionId),
        ),
      );
    return flipped;
  }

  async finishDelete(userId: string, revisionId: string): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "deleting", "deleted");
    if (!flipped) return null;
    await this.adjust(userId, { usedBytes: -flipped.reservedBytes });
    return flipped;
  }

  async setAutoUploadExcluded(
    userId: string,
    assetId: string,
    excluded: boolean,
  ): Promise<CloudAsset | null> {
    const [row] = await this.db
      .update(cloudAssetTable)
      .set({ autoUploadExcluded: excluded })
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, assetId)))
      .returning();
    return row ? mapCloudAssetToDomain(row) : null;
  }

  async listAssets(
    userId: string,
    params: { cursor: string | null; limit: number },
  ): Promise<AssetPage> {
    const after = params.cursor ? decodeCursor(params.cursor) : null;
    const rows = await this.db
      .select({ asset: cloudAssetTable, revision: cloudRevisionTable })
      .from(cloudAssetTable)
      .innerJoin(
        cloudRevisionTable,
        eq(cloudRevisionTable.revisionId, cloudAssetTable.currentRevisionId),
      )
      .where(
        and(
          eq(cloudAssetTable.userId, userId),
          after
            ? or(
                lt(cloudAssetTable.createdAt, after.createdAt),
                and(
                  eq(cloudAssetTable.createdAt, after.createdAt),
                  lt(cloudAssetTable.assetId, after.assetId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(cloudAssetTable.createdAt), desc(cloudAssetTable.assetId))
      .limit(params.limit + 1);
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        asset: mapCloudAssetToDomain(r.asset),
        current: mapCloudRevisionToDomain(r.revision),
      })),
      nextCursor:
        rows.length > params.limit && last
          ? encodeCursor(last.asset.createdAt, last.asset.assetId)
          : null,
    };
  }

  async usage(userId: string): Promise<AccountUsage> {
    const [row] = await this.db
      .select()
      .from(cloudStorageAccountTable)
      .where(eq(cloudStorageAccountTable.userId, userId))
      .limit(1);
    return row
      ? {
          usedBytes: row.usedBytes,
          reservedBytes: row.reservedBytes,
          pendingUploads: row.pendingUploads,
        }
      : { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };
  }

  async reconcile(userId: string): Promise<AccountUsage> {
    const [sums] = await this.db
      .select({
        used: sql<number>`coalesce(sum(case when ${cloudRevisionTable.status} in ('ready','deleting') then ${cloudRevisionTable.reservedBytes} else 0 end), 0)::bigint`,
        reserved: sql<number>`coalesce(sum(case when ${cloudRevisionTable.status} = 'reserved' then ${cloudRevisionTable.reservedBytes} else 0 end), 0)::bigint`,
        pending: sql<number>`count(*) filter (where ${cloudRevisionTable.status} = 'reserved')::int`,
      })
      .from(cloudRevisionTable)
      .where(eq(cloudRevisionTable.userId, userId));
    const usage = {
      usedBytes: Number(sums?.used ?? 0),
      reservedBytes: Number(sums?.reserved ?? 0),
      pendingUploads: Number(sums?.pending ?? 0),
    };
    await this.db
      .insert(cloudStorageAccountTable)
      .values({ userId, ...usage })
      .onConflictDoUpdate({ target: cloudStorageAccountTable.userId, set: usage });
    return usage;
  }

  async listReservedExpiredBefore(before: Date, limit: number): Promise<CloudRevision[]> {
    const rows = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(
        and(
          eq(cloudRevisionTable.status, "reserved"),
          lt(cloudRevisionTable.ticketExpiresAt, before),
        ),
      )
      .orderBy(cloudRevisionTable.ticketExpiresAt)
      .limit(limit);
    return rows.map(mapCloudRevisionToDomain);
  }

  async listDeleting(limit: number): Promise<CloudRevision[]> {
    const rows = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(eq(cloudRevisionTable.status, "deleting"))
      .orderBy(cloudRevisionTable.updatedAt)
      .limit(limit);
    return rows.map(mapCloudRevisionToDomain);
  }

  async listAccountsTouchedSince(since: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ userId: cloudStorageAccountTable.userId })
      .from(cloudStorageAccountTable)
      .where(gt(cloudStorageAccountTable.updatedAt, since))
      .limit(limit);
    return rows.map((r) => r.userId);
  }
}
