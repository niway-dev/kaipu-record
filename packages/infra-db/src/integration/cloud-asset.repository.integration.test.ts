import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AssetConflictError } from "@kaipu/domain/schemas";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { CloudAssetRepository } from "../repositories/cloud-asset.repository";
import { cloudAssetTable, cloudRevisionTable, cloudStorageAccountTable } from "../schema/cloud";
import { userTable } from "../schema/auth";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("CloudAssetRepository (real database)", () => {
  // `../client` builds a default client from DATABASE_URL at import time, which throws when that
  // variable is unset. Importing it lazily (only when the suite actually runs) lets the file
  // report as skipped without either variable. Vitest still runs a skipped describe body, so
  // nothing in this body may touch the client synchronously.
  let db: DatabaseClient;
  let repo: CloudAssetRepository;
  beforeAll(async () => {
    const { createDatabaseClient } = await import("../client");
    db = createDatabaseClient(url ?? "");
    repo = new CloudAssetRepository(db);
  });
  // Unique per run: this suite creates and deletes only this throwaway user's rows.
  const USER = `it-cloud-user-${crypto.randomUUID()}`;
  const USER_EMAIL = `${USER}@example.com`;

  function reserveData(overrides: Partial<Parameters<CloudAssetRepository["reserve"]>[0]> = {}) {
    const revisionId = crypto.randomUUID();
    return {
      userId: USER,
      assetId: crypto.randomUUID(),
      intentKey: crypto.randomUUID(),
      revisionId,
      kind: "recording" as const,
      title: "it",
      durationSeconds: 1,
      derivedFromAssetId: null,
      storageKey: `videos/${USER}/x/${revisionId}.mp4`,
      thumbnailKey: null,
      contentType: "video/mp4",
      sizeBytes: 600,
      thumbnailBytes: 0,
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      reservedBytes: 600,
      ticketExpiresAt: new Date(Date.now() + 60_000),
      capacityBytes: 1000,
      maxPending: 5,
      ...overrides,
    };
  }

  async function cleanup() {
    await db.delete(cloudRevisionTable).where(eq(cloudRevisionTable.userId, USER));
    await db.delete(cloudAssetTable).where(eq(cloudAssetTable.userId, USER));
    await db.delete(cloudStorageAccountTable).where(eq(cloudStorageAccountTable.userId, USER));
  }

  beforeEach(async () => {
    await db
      .insert(userTable)
      .values({ id: USER, name: "it", email: USER_EMAIL })
      .onConflictDoNothing();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await db.delete(userTable).where(eq(userTable.id, USER));
  });

  it("two concurrent reservations competing for the last bytes: exactly one wins", async () => {
    const results = await Promise.all([repo.reserve(reserveData()), repo.reserve(reserveData())]);
    const kinds = results.map((r) => r.kind).sort();
    expect(kinds).toEqual(["quota-exceeded", "reserved"]);
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 600, pendingUploads: 1 });
  });

  it("ready → deleting → deleted settles used bytes once, and repeated finishDelete is a no-op", async () => {
    const r = await repo.reserve(reserveData());
    if (r.kind !== "reserved") throw new Error(r.kind);
    await repo.markReady(USER, r.revision.revisionId, new Date());
    await repo.markReady(USER, r.revision.revisionId, new Date()); // idempotent
    expect(await repo.usage(USER)).toEqual({ usedBytes: 600, reservedBytes: 0, pendingUploads: 0 });

    expect(await repo.beginDelete(USER, r.revision.revisionId)).not.toBeNull();
    expect(await repo.beginDelete(USER, r.revision.revisionId)).toBeNull();
    expect(await repo.finishDelete(USER, r.revision.revisionId)).not.toBeNull();
    expect(await repo.finishDelete(USER, r.revision.revisionId)).toBeNull();
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect((await repo.findAsset(USER, r.asset.assetId))?.asset.autoUploadExcluded).toBe(true);
  });

  it("release is idempotent and never drives counters negative", async () => {
    const r = await repo.reserve(reserveData());
    if (r.kind !== "reserved") throw new Error(r.kind);
    await repo.release(USER, r.revision.revisionId);
    await repo.release(USER, r.revision.revisionId);
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
  });

  it("enforces the pending cap", async () => {
    await repo.reserve(reserveData({ sizeBytes: 100, reservedBytes: 100, maxPending: 1 }));
    const second = await repo.reserve(
      reserveData({ sizeBytes: 100, reservedBytes: 100, maxPending: 1 }),
    );
    expect(second.kind).toBe("too-many-pending");
  });

  it("reconcile rebuilds the counters from revision rows", async () => {
    const r = await repo.reserve(reserveData());
    if (r.kind !== "reserved") throw new Error(r.kind);
    await db
      .update(cloudStorageAccountTable)
      .set({ reservedBytes: 999_999, pendingUploads: 42 })
      .where(eq(cloudStorageAccountTable.userId, USER));
    expect(await repo.reconcile(USER)).toEqual({
      usedBytes: 0,
      reservedBytes: 600,
      pendingUploads: 1,
    });
  });

  it("paginates newest-first with a stable keyset cursor", async () => {
    for (let i = 0; i < 3; i += 1) {
      const r = await repo.reserve(reserveData({ sizeBytes: 100, reservedBytes: 100 }));
      if (r.kind !== "reserved") throw new Error(r.kind);
      await repo.markReady(USER, r.revision.revisionId, new Date());
    }
    const page1 = await repo.listAssets(USER, { cursor: null, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.listAssets(USER, { cursor: page1.nextCursor, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items].map((i) => i.asset.assetId);
    expect(new Set(ids).size).toBe(3);
  });

  async function revisionRows() {
    return db.select().from(cloudRevisionTable).where(eq(cloudRevisionTable.userId, USER));
  }

  async function trueSums() {
    const rows = await revisionRows();
    let usedBytes = 0;
    let reservedBytes = 0;
    let pendingUploads = 0;
    for (const r of rows) {
      if (r.status === "ready" || r.status === "deleting") usedBytes += r.reservedBytes;
      if (r.status === "reserved") {
        reservedBytes += r.reservedBytes;
        pendingUploads += 1;
      }
    }
    return { usedBytes, reservedBytes, pendingUploads };
  }

  it("two parallel reserves with the same intent key: one wins, the loser changes nothing", async () => {
    const intentKey = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const results = await Promise.allSettled([
      repo.reserve(reserveData({ intentKey, assetId, sizeBytes: 100, reservedBytes: 100 })),
      repo.reserve(reserveData({ intentKey, assetId, sizeBytes: 100, reservedBytes: 100 })),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]?.status === "fulfilled" && fulfilled[0].value.kind).toBe("reserved");
    const reason = rejected[0]?.status === "rejected" ? rejected[0].reason : null;
    // The application layer must never see a raw Postgres error code for this race.
    expect(reason).toBeInstanceOf(AssetConflictError);
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 100, pendingUploads: 1 });
    expect(await revisionRows()).toHaveLength(1);
    const assets = await db.select().from(cloudAssetTable).where(eq(cloudAssetTable.userId, USER));
    expect(assets).toHaveLength(1);
  });

  it("reconcile racing a burst of reserves leaves counters equal to the revision sums", async () => {
    for (let round = 0; round < 4; round += 1) {
      await Promise.all([
        ...Array.from({ length: 5 }, () =>
          repo.reserve(
            reserveData({
              sizeBytes: 10,
              reservedBytes: 10,
              capacityBytes: 1_000_000,
              maxPending: 1000,
            }),
          ),
        ),
        repo.reconcile(USER),
      ]);
      const expected = await trueSums();
      expect(expected.pendingUploads).toBe(5 * (round + 1));
      expect(await repo.usage(USER)).toEqual(expected);
    }
  });

  it("a reserve on a tombstoned asset does not resurrect it and writes nothing", async () => {
    const first = await repo.reserve(reserveData({ sizeBytes: 100, reservedBytes: 100 }));
    if (first.kind !== "reserved") throw new Error(first.kind);
    await repo.markReady(USER, first.revision.revisionId, new Date());
    const deletedAt = new Date();
    await db
      .update(cloudAssetTable)
      .set({ deletedAt })
      .where(
        and(eq(cloudAssetTable.userId, USER), eq(cloudAssetTable.assetId, first.asset.assetId)),
      );
    const before = await repo.usage(USER);

    await expect(
      repo.reserve(
        reserveData({
          assetId: first.asset.assetId,
          title: "resurrected",
          sizeBytes: 100,
          reservedBytes: 100,
        }),
      ),
    ).rejects.toBeInstanceOf(AssetConflictError);

    const found = await repo.findAsset(USER, first.asset.assetId);
    expect(found?.asset.deletedAt).not.toBeNull();
    expect(found?.asset.title).toBe("it");
    expect(await repo.usage(USER)).toEqual(before);
    expect(await revisionRows()).toHaveLength(1);
  });

  it("confirming an older revision after a newer one keeps the asset on the newer revision", async () => {
    const assetId = crypto.randomUUID();
    const older = await repo.reserve(reserveData({ assetId, sizeBytes: 100, reservedBytes: 100 }));
    if (older.kind !== "reserved") throw new Error(older.kind);
    const newer = await repo.reserve(reserveData({ assetId, sizeBytes: 100, reservedBytes: 100 }));
    if (newer.kind !== "reserved") throw new Error(newer.kind);

    expect(await repo.markReady(USER, newer.revision.revisionId, new Date())).not.toBeNull();
    expect(await repo.markReady(USER, older.revision.revisionId, new Date())).not.toBeNull();

    expect((await repo.findAsset(USER, assetId))?.asset.currentRevisionId).toBe(
      newer.revision.revisionId,
    );
    expect(await repo.usage(USER)).toEqual({ usedBytes: 200, reservedBytes: 0, pendingUploads: 0 });
  });
});
