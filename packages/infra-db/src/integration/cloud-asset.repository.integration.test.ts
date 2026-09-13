import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabaseClient } from "../client";
import { CloudAssetRepository } from "../repositories/cloud-asset.repository";
import { cloudAssetTable, cloudRevisionTable, cloudStorageAccountTable } from "../schema/cloud";
import { userTable } from "../schema/auth";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("CloudAssetRepository (real database)", () => {
  // Placeholder keeps `createDatabaseClient` from throwing at suite-collection time when the
  // suite is skipped (Vitest still runs this describe body's top-level code for `describe.skip`,
  // it only skips the `it` callbacks) — no query ever reaches this client without TEST_DATABASE_URL.
  const db = createDatabaseClient(url ?? "postgresql://user:pass@host.invalid/db");
  const repo = new CloudAssetRepository(db);
  // Unique per run: this suite creates and deletes only this throwaway user's rows.
  const USER = `it-cloud-user-${crypto.randomUUID()}`;
  const USER_EMAIL = `${USER}@example.com`;

  function reserveData(overrides: Partial<Parameters<typeof repo.reserve>[0]> = {}) {
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
});
