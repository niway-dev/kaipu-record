import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { AccountDeletionRepository } from "../repositories/account-deletion.repository";
import { sessionTable, userTable } from "../schema/auth";
import { cloudPurgeTable } from "../schema/cloud";

const url = process.env.TEST_DATABASE_URL;
// Fail, never skip — same rule as cloud-asset.repository.integration.test.ts.
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set, so these tests would report success without reaching a " +
      "database. Point it at a THROWAWAY database: this suite creates and deletes rows.",
  );
}

const DAY = 24 * 60 * 60 * 1000;

describe("AccountDeletionRepository (real database)", () => {
  let db: DatabaseClient;
  let repo: AccountDeletionRepository;
  const USER = `it-deletion-${crypto.randomUUID()}`;
  const NOW = new Date();

  beforeAll(async () => {
    const { createDatabaseClient } = await import("../client");
    db = createDatabaseClient(url);
    repo = new AccountDeletionRepository(db);
    await db.insert(userTable).values({
      id: USER,
      name: "it",
      email: `${USER}@example.com`,
      emailVerified: true,
    });
    await db.insert(sessionTable).values({
      id: `${USER}-s`,
      token: `${USER}-t`,
      userId: USER,
      expiresAt: new Date(NOW.getTime() + DAY),
      updatedAt: NOW,
    });
  });

  afterAll(async () => {
    await db.delete(cloudPurgeTable).where(eq(cloudPurgeTable.userId, USER));
    await db.delete(userTable).where(eq(userTable.id, USER));
  });

  it("schedules once, revokes sessions, restores, and finalizes only when due", async () => {
    const scheduledAt = new Date(NOW.getTime() + 7 * DAY);
    const first = await repo.schedule({
      userId: USER,
      requestedAt: NOW,
      scheduledAt,
      locale: "es",
    });
    const again = await repo.schedule({
      userId: USER,
      requestedAt: new Date(NOW.getTime() + DAY),
      scheduledAt: new Date(NOW.getTime() + 8 * DAY),
      locale: "en",
    });
    expect(again.scheduledAt.getTime()).toBe(first.scheduledAt.getTime());
    expect(await repo.revokeSessions(USER)).toBe(1);

    expect(await repo.finalize(USER, NOW)).toBe(false); // still in the grace period
    expect(await repo.cancel(USER)).toBe(true);
    expect(await repo.find(USER)).toBeNull();

    await repo.schedule({ userId: USER, requestedAt: NOW, scheduledAt, locale: "es" });
    const later = new Date(scheduledAt.getTime() + 1);
    const due = (await repo.listDue(later, 1000)).find((d) => d.userId === USER);
    expect(due).toMatchObject({ email: `${USER}@example.com`, locale: "es" });

    expect(await repo.finalize(USER, later)).toBe(true);
    const users = await db.select().from(userTable).where(eq(userTable.id, USER));
    expect(users).toHaveLength(0);
    const jobs = await db.select().from(cloudPurgeTable).where(eq(cloudPurgeTable.userId, USER));
    expect(jobs).toHaveLength(1);
    expect(await repo.finalize(USER, later)).toBe(false); // idempotent: nothing left to do
  });
});
