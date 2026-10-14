import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { CloudPurgeRepository } from "../repositories/cloud-purge.repository";
import { userTable } from "../schema/auth";
import { cloudPurgeTable } from "../schema/cloud";

const url = process.env.TEST_DATABASE_URL;
// Fail, never skip — same rule as cloud-asset.repository.integration.test.ts.
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set, so these tests would report success without reaching a " +
      "database. Point it at a THROWAWAY database: this suite creates and deletes rows.",
  );
}

describe("CloudPurgeRepository (real database)", () => {
  let db: DatabaseClient;
  let repo: CloudPurgeRepository;
  const LIVE = `it-purge-live-${crypto.randomUUID()}`;
  const GONE = `it-purge-gone-${crypto.randomUUID()}`;

  beforeAll(async () => {
    const { createDatabaseClient } = await import("../client");
    db = createDatabaseClient(url);
    repo = new CloudPurgeRepository(db);
    await db.insert(userTable).values({
      id: LIVE,
      name: "it",
      email: `${LIVE}@example.com`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await db.delete(cloudPurgeTable).where(inArray(cloudPurgeTable.userId, [LIVE, GONE]));
    await db.delete(userTable).where(eq(userTable.id, LIVE));
  });

  it("hands out jobs only once the user row is gone (a failed account delete purges nothing)", async () => {
    await repo.enqueue(LIVE); // beforeDelete ran, then the delete failed: the user still exists
    await repo.enqueue(GONE); // the normal path: the user row was deleted
    const pending = (await repo.nextPending(100)).map((j) => j.userId);
    expect(pending).toContain(GONE);
    expect(pending).not.toContain(LIVE);
  });

  it("puts jobs with fewer attempts first, so a stuck job cannot hold the only slot", async () => {
    const [stuck] = (await repo.nextPending(100)).filter((j) => j.userId === GONE);
    for (let i = 0; i < 10; i++) await repo.markAttempt(stuck!.id, "boom");
    const fresh = `it-purge-fresh-${crypto.randomUUID()}`;
    await repo.enqueue(fresh);
    try {
      const ours = (await repo.nextPending(100)).filter((j) => [GONE, fresh].includes(j.userId));
      expect(ours.map((j) => j.userId)).toEqual([fresh, GONE]);
    } finally {
      await db.delete(cloudPurgeTable).where(eq(cloudPurgeTable.userId, fresh));
    }
  });
});
