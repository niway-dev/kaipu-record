import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { CloudPurgeRepository } from "../repositories/cloud-purge.repository";
import { cloudAssetTable, cloudPurgeTable, cloudRevisionTable } from "../schema/cloud";
import { userTable } from "../schema/auth";

const url = process.env.TEST_DATABASE_URL;
// Fail, never skip — see cloud-asset.repository.integration.test.ts for why.
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set, so these tests would report success without reaching a " +
      "database.\nAdd it to Infisical under the `db-scripts` tag, pointing at a THROWAWAY " +
      "database: this suite creates and deletes rows.",
  );
}

/** NIW2-328: the purge queue's guards and the foreign keys of `0001_integrity`. */
describe("CloudPurgeRepository and cloud integrity (real database)", () => {
  // Lazy import: `../client` throws at import time without DATABASE_URL (same as the asset suite).
  let db: DatabaseClient;
  let repo: CloudPurgeRepository;
  beforeAll(async () => {
    const { createDatabaseClient } = await import("../client");
    db = createDatabaseClient(url);
    repo = new CloudPurgeRepository(db);
  });
  // Unique per run: this suite creates and deletes only this throwaway user's rows.
  const USER = `it-purge-user-${crypto.randomUUID()}`;

  async function insertUser() {
    await db
      .insert(userTable)
      .values({ id: USER, name: "it", email: `${USER}@example.com` })
      .onConflictDoNothing();
  }

  async function cleanup() {
    await db.delete(cloudPurgeTable).where(eq(cloudPurgeTable.userId, USER));
    await db.delete(cloudRevisionTable).where(eq(cloudRevisionTable.userId, USER));
    await db.delete(cloudAssetTable).where(eq(cloudAssetTable.userId, USER));
    await db.delete(userTable).where(eq(userTable.id, USER));
  }

  async function insertAssetWithRevision() {
    const assetId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await db
      .insert(cloudAssetTable)
      .values({ userId: USER, assetId, kind: "recording", title: "it" });
    await db.insert(cloudRevisionTable).values({
      revisionId,
      userId: USER,
      assetId,
      intentKey: crypto.randomUUID(),
      storageKey: `videos/${USER}/${assetId}/${revisionId}.mp4`,
      contentType: "video/mp4",
      sizeBytes: 1,
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      reservedBytes: 1,
      ticketExpiresAt: new Date(Date.now() + 60_000),
    });
    await db
      .update(cloudAssetTable)
      .set({ currentRevisionId: revisionId })
      .where(eq(cloudAssetTable.assetId, assetId));
    return { assetId, revisionId };
  }

  beforeEach(async () => {
    await cleanup();
    await insertUser();
  });

  afterAll(cleanup);

  it("enqueue is idempotent while a job is pending", async () => {
    await repo.enqueue(USER);
    await repo.enqueue(USER);
    const rows = await db.select().from(cloudPurgeTable).where(eq(cloudPurgeTable.userId, USER));
    expect(rows).toHaveLength(1);
  });

  it("nextPending never returns a job whose user row still exists", async () => {
    await repo.enqueue(USER);
    expect((await repo.nextPending(1000)).map((j) => j.userId)).not.toContain(USER);
    await db.delete(userTable).where(eq(userTable.id, USER));
    expect((await repo.nextPending(1000)).map((j) => j.userId)).toContain(USER);
  });

  it("the purge job survives the user cascade that removes the cloud rows", async () => {
    await insertAssetWithRevision();
    await repo.enqueue(USER);
    await db.delete(userTable).where(eq(userTable.id, USER));
    expect(await db.select().from(cloudAssetTable).where(eq(cloudAssetTable.userId, USER))).toEqual(
      [],
    );
    const jobs = await db.select().from(cloudPurgeTable).where(eq(cloudPurgeTable.userId, USER));
    expect(jobs).toHaveLength(1);
  });

  it("a revision cannot point at an asset that does not exist", async () => {
    await expect(
      db.insert(cloudRevisionTable).values({
        revisionId: crypto.randomUUID(),
        userId: USER,
        assetId: "no-such-asset",
        intentKey: crypto.randomUUID(),
        storageKey: `videos/${USER}/missing/${crypto.randomUUID()}.mp4`,
        contentType: "video/mp4",
        sizeBytes: 1,
        contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
        reservedBytes: 1,
        ticketExpiresAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("deleting an asset cascades to its revisions", async () => {
    const { assetId, revisionId } = await insertAssetWithRevision();
    await db
      .update(cloudAssetTable)
      .set({ currentRevisionId: null })
      .where(eq(cloudAssetTable.assetId, assetId));
    await db.delete(cloudAssetTable).where(eq(cloudAssetTable.assetId, assetId));
    expect(
      await db
        .select()
        .from(cloudRevisionTable)
        .where(eq(cloudRevisionTable.revisionId, revisionId)),
    ).toEqual([]);
  });

  it("deleting the current revision clears the asset's pointer instead of leaving it dangling", async () => {
    const { assetId, revisionId } = await insertAssetWithRevision();
    await db.delete(cloudRevisionTable).where(eq(cloudRevisionTable.revisionId, revisionId));
    const [asset] = await db
      .select()
      .from(cloudAssetTable)
      .where(eq(cloudAssetTable.assetId, assetId));
    expect(asset?.currentRevisionId).toBeNull();
  });
});
