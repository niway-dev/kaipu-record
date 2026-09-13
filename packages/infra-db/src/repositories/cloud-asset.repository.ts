import type {
  AccountUsage,
  AssetPage,
  ICloudAssetRepository,
  ReserveOutcome,
  ReserveRevisionData,
} from "@kaipu/domain/repositories";
import type { CloudAsset, CloudRevision } from "@kaipu/domain/schemas";
import { AssetConflictError } from "@kaipu/domain/schemas";
import { and, desc, eq, gt, lt, or, type SQL, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { mapCloudAssetToDomain, mapCloudRevisionToDomain } from "../mappers/cloud.mapper";
import { cloudAssetTable, cloudRevisionTable, cloudStorageAccountTable } from "../schema/cloud";

type AssetRow = typeof cloudAssetTable.$inferSelect;
type RevisionRow = typeof cloudRevisionTable.$inferSelect;
/** A table row serialised with `to_jsonb` — snake_case keys, timestamps without zone. */
type JsonRow = Record<string, unknown>;

/** `timestamp` (without time zone) columns store UTC wall-clock time, as drizzle does. */
function toTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
function fromTimestamp(value: unknown): Date {
  // `to_jsonb` renders microseconds ("2026-09-13T08:00:00.123456"); keep milliseconds.
  const text = String(value).replace(/(\.\d{3})\d+$/, "$1");
  return new Date(`${text}Z`);
}
function nullableTimestamp(value: unknown): Date | null {
  return value == null ? null : fromTimestamp(value);
}

function assetFromJson(j: JsonRow): AssetRow {
  return {
    userId: String(j.user_id),
    assetId: String(j.asset_id),
    kind: String(j.kind),
    title: String(j.title),
    currentRevisionId: (j.current_revision_id as string | null) ?? null,
    durationSeconds: Number(j.duration_seconds),
    derivedFromAssetId: (j.derived_from_asset_id as string | null) ?? null,
    autoUploadExcluded: Boolean(j.auto_upload_excluded),
    createdAt: fromTimestamp(j.created_at),
    updatedAt: fromTimestamp(j.updated_at),
    deletedAt: nullableTimestamp(j.deleted_at),
  };
}

function revisionFromJson(j: JsonRow): RevisionRow {
  return {
    revisionId: String(j.revision_id),
    userId: String(j.user_id),
    assetId: String(j.asset_id),
    intentKey: String(j.intent_key),
    status: String(j.status),
    storageKey: String(j.storage_key),
    thumbnailKey: (j.thumbnail_key as string | null) ?? null,
    contentType: String(j.content_type),
    sizeBytes: Number(j.size_bytes),
    thumbnailBytes: Number(j.thumbnail_bytes),
    contentSha256: String(j.content_sha256),
    reservedBytes: Number(j.reserved_bytes),
    ticketExpiresAt: fromTimestamp(j.ticket_expires_at),
    verifiedAt: nullableTimestamp(j.verified_at),
    createdAt: fromTimestamp(j.created_at),
    updatedAt: fromTimestamp(j.updated_at),
  };
}

function isNotNullViolation(err: unknown, column: string): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: unknown; column?: unknown };
    if (pg.code === "23502" && pg.column === column) return true;
  }
  return false;
}

/**
 * A concurrent `reserve` for the same (user, intentKey) loses a unique-index race on
 * `cloud_revision_user_intent_idx`. The application layer must never see a raw Postgres error
 * code for this — it maps to `AssetConflictError` so the caller can resolve to the winning
 * revision via `findByIntentKey`.
 */
function isIntentKeyViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: unknown; constraint?: unknown; detail?: unknown };
    if (pg.code !== "23505") continue;
    if (pg.constraint === "cloud_revision_user_intent_idx") return true;
    if (typeof pg.detail === "string" && pg.detail.includes("cloud_revision_user_intent_idx"))
      return true;
  }
  return false;
}

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

  /**
   * Atomic reservation. Every counter change happens in the SAME SQL statement as the revision
   * row it accounts for (data-modifying CTEs), because the Neon HTTP driver autocommits each
   * statement and has no interactive transactions. A failure anywhere in the statement (for
   * example the (user, intentKey) unique violation) rolls back the counter bump and the asset
   * upsert together.
   *
   * Tombstoned assets (`deleted_at` set) are never resurrected: the asset upsert only updates a
   * live row, and when it returns nothing the revision insert gets a NULL `asset_id`, which
   * violates NOT NULL and aborts the whole statement. The caller then gets `AssetConflictError`.
   */
  async reserve(data: ReserveRevisionData): Promise<ReserveOutcome> {
    // Idempotent bootstrap of the accounting row. Safe as its own statement: it never changes
    // counters of an existing row.
    await this.db
      .insert(cloudStorageAccountTable)
      .values({ userId: data.userId })
      .onConflictDoNothing();

    let rows: Array<{ asset: JsonRow | null; revision: JsonRow | null }>;
    try {
      const result = await this.db.execute<{ asset: JsonRow | null; revision: JsonRow | null }>(sql`
        with acct as (
          update ${cloudStorageAccountTable}
          set reserved_bytes = reserved_bytes + ${data.reservedBytes},
              pending_uploads = pending_uploads + 1,
              updated_at = now()
          where user_id = ${data.userId}
            and used_bytes + reserved_bytes + ${data.reservedBytes} <= ${data.capacityBytes}
            and pending_uploads < ${data.maxPending}
          returning user_id
        ),
        up as (
          insert into ${cloudAssetTable}
            (user_id, asset_id, kind, title, duration_seconds, derived_from_asset_id)
          select ${data.userId}, ${data.assetId}, ${data.kind}, ${data.title},
                 ${data.durationSeconds}, ${data.derivedFromAssetId}
          from acct
          on conflict (user_id, asset_id) do update
            set title = excluded.title,
                duration_seconds = excluded.duration_seconds,
                updated_at = now()
            where ${cloudAssetTable}.deleted_at is null
          returning *
        ),
        rev as (
          insert into ${cloudRevisionTable}
            (revision_id, user_id, asset_id, intent_key, status, storage_key, thumbnail_key,
             content_type, size_bytes, thumbnail_bytes, content_sha256, reserved_bytes,
             ticket_expires_at)
          select ${data.revisionId}, acct.user_id, up.asset_id, ${data.intentKey}, 'reserved',
                 ${data.storageKey}, ${data.thumbnailKey}, ${data.contentType}, ${data.sizeBytes},
                 ${data.thumbnailBytes}, ${data.contentSha256}, ${data.reservedBytes},
                 ${toTimestamp(data.ticketExpiresAt)}::timestamp
          from acct left join up on true
          returning *
        )
        select (select to_jsonb(up) from up) as asset, (select to_jsonb(rev) from rev) as revision
      `);
      rows = result.rows;
    } catch (err) {
      if (
        isNotNullViolation(err, "asset_id") &&
        (await this.isTombstoned(data.userId, data.assetId))
      ) {
        throw new AssetConflictError(
          "The cloud asset was deleted; it cannot receive new revisions",
        );
      }
      if (isIntentKeyViolation(err)) {
        throw new AssetConflictError("An upload intent with this key already exists");
      }
      throw err;
    }

    const row = rows[0];
    if (row?.asset && row.revision) {
      return {
        kind: "reserved",
        asset: mapCloudAssetToDomain(assetFromJson(row.asset)),
        revision: mapCloudRevisionToDomain(revisionFromJson(row.revision)),
      };
    }

    // Refused by the conditional UPDATE: nothing was written. Classify with read-only queries.
    if (await this.isTombstoned(data.userId, data.assetId)) {
      throw new AssetConflictError("The cloud asset was deleted; it cannot receive new revisions");
    }
    const current = await this.usage(data.userId);
    if (current.pendingUploads >= data.maxPending) return { kind: "too-many-pending" };
    return {
      kind: "quota-exceeded",
      usedBytes: current.usedBytes,
      reservedBytes: current.reservedBytes,
    };
  }

  private async isTombstoned(userId: string, assetId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ deletedAt: cloudAssetTable.deletedAt })
      .from(cloudAssetTable)
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, assetId)))
      .limit(1);
    return row?.deletedAt != null;
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

  /**
   * One statement per lifecycle transition: a status-guarded UPDATE of the revision, the counter
   * adjustment computed from the row it returned (floored at zero), and — where relevant — the
   * asset pointer change. A crash can no longer separate a transition from its accounting, and
   * a second call finds the status already moved and changes nothing.
   */
  private async runTransition(statement: SQL): Promise<CloudRevision | null> {
    const result = await this.db.execute<{ revision: JsonRow | null }>(statement);
    const json = result.rows[0]?.revision;
    return json ? mapCloudRevisionToDomain(revisionFromJson(json)) : null;
  }

  async markReady(
    userId: string,
    revisionId: string,
    verifiedAt: Date,
  ): Promise<CloudRevision | null> {
    const flipped = await this.runTransition(sql`
      with f as (
        update ${cloudRevisionTable}
        set status = 'ready', verified_at = ${toTimestamp(verifiedAt)}::timestamp, updated_at = now()
        where user_id = ${userId} and revision_id = ${revisionId} and status = 'reserved'
        returning *
      ),
      acct as (
        update ${cloudStorageAccountTable} a
        set used_bytes = greatest(0, a.used_bytes + f.reserved_bytes),
            reserved_bytes = greatest(0, a.reserved_bytes - f.reserved_bytes),
            pending_uploads = greatest(0, a.pending_uploads - 1),
            updated_at = now()
        from f
        where a.user_id = f.user_id
        returning a.user_id
      ),
      pointer as (
        update ${cloudAssetTable} s
        set current_revision_id = f.revision_id, updated_at = now()
        from f
        where s.user_id = f.user_id
          and s.asset_id = f.asset_id
          and (
            s.current_revision_id is null
            or not exists (
              select 1 from ${cloudRevisionTable} c
              where c.revision_id = s.current_revision_id
                and (c.created_at, c.revision_id) > (f.created_at, f.revision_id)
            )
          )
        returning s.asset_id
      )
      select (select to_jsonb(f) from f) as revision,
             (select count(*) from acct) as accounted,
             (select count(*) from pointer) as pointed
    `);
    if (flipped) return flipped;
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

  async release(userId: string, revisionId: string): Promise<CloudRevision | null> {
    return this.runTransition(sql`
      with f as (
        update ${cloudRevisionTable}
        set status = 'expired', updated_at = now()
        where user_id = ${userId} and revision_id = ${revisionId} and status = 'reserved'
        returning *
      ),
      acct as (
        update ${cloudStorageAccountTable} a
        set reserved_bytes = greatest(0, a.reserved_bytes - f.reserved_bytes),
            pending_uploads = greatest(0, a.pending_uploads - 1),
            updated_at = now()
        from f
        where a.user_id = f.user_id
        returning a.user_id
      )
      select (select to_jsonb(f) from f) as revision, (select count(*) from acct) as accounted
    `);
  }

  async beginDelete(userId: string, revisionId: string): Promise<CloudRevision | null> {
    // No counter change: `deleting` bytes stay in `used` until the object is gone.
    return this.runTransition(sql`
      with f as (
        update ${cloudRevisionTable}
        set status = 'deleting', updated_at = now()
        where user_id = ${userId} and revision_id = ${revisionId} and status = 'ready'
        returning *
      ),
      pointer as (
        update ${cloudAssetTable} s
        set current_revision_id = null, auto_upload_excluded = true, updated_at = now()
        from f
        where s.user_id = f.user_id
          and s.asset_id = f.asset_id
          and s.current_revision_id = f.revision_id
        returning s.asset_id
      )
      select (select to_jsonb(f) from f) as revision, (select count(*) from pointer) as pointed
    `);
  }

  async finishDelete(userId: string, revisionId: string): Promise<CloudRevision | null> {
    return this.runTransition(sql`
      with f as (
        update ${cloudRevisionTable}
        set status = 'deleted', updated_at = now()
        where user_id = ${userId} and revision_id = ${revisionId} and status = 'deleting'
        returning *
      ),
      acct as (
        update ${cloudStorageAccountTable} a
        set used_bytes = greatest(0, a.used_bytes - f.reserved_bytes), updated_at = now()
        from f
        where a.user_id = f.user_id
        returning a.user_id
      )
      select (select to_jsonb(f) from f) as revision, (select count(*) from acct) as accounted
    `);
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

  /**
   * Rebuilds the counters from revision rows as ONE non-interactive transaction (drizzle
   * neon-http `batch` → neon `sql.transaction`). The row lock taken by `for update` is held
   * until commit, and every writer changes the account row in the same statement as the
   * revision change it accounts for, so no writer can commit between the lock and the sums.
   * Under READ COMMITTED the sums statement takes a fresh snapshot after the lock is granted.
   */
  async reconcile(userId: string): Promise<AccountUsage> {
    const [, , result] = await this.db.batch([
      this.db.insert(cloudStorageAccountTable).values({ userId }).onConflictDoNothing(),
      this.db.execute(
        sql`select user_id from ${cloudStorageAccountTable} where user_id = ${userId} for update`,
      ),
      this.db.execute<{
        used_bytes: string | number;
        reserved_bytes: string | number;
        pending_uploads: string | number;
      }>(sql`
        update ${cloudStorageAccountTable} a
        set used_bytes = s.used, reserved_bytes = s.reserved, pending_uploads = s.pending,
            updated_at = now()
        from (
          select
            coalesce(sum(reserved_bytes) filter (where status in ('ready', 'deleting')), 0)::bigint as used,
            coalesce(sum(reserved_bytes) filter (where status = 'reserved'), 0)::bigint as reserved,
            (count(*) filter (where status = 'reserved'))::int as pending
          from ${cloudRevisionTable}
          where user_id = ${userId}
        ) s
        where a.user_id = ${userId}
        returning a.used_bytes, a.reserved_bytes, a.pending_uploads
      `),
    ]);
    const row = result.rows[0];
    if (!row) throw new Error("reconcile: accounting row missing after bootstrap");
    return {
      usedBytes: Number(row.used_bytes),
      reservedBytes: Number(row.reserved_bytes),
      pendingUploads: Number(row.pending_uploads),
    };
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
