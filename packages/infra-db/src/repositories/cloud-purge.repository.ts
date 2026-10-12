import type { ICloudPurgeRepository, PurgeJob } from "@kaipu/domain/repositories";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { userTable } from "../schema/auth";
import { cloudPurgeTable } from "../schema/cloud";

export class CloudPurgeRepository implements ICloudPurgeRepository {
  constructor(private db: DatabaseClient) {}

  /** Idempotent: a user with a pending job does not get a second one. */
  async enqueue(userId: string): Promise<void> {
    const [pending] = await this.db
      .select({ id: cloudPurgeTable.id })
      .from(cloudPurgeTable)
      .where(and(eq(cloudPurgeTable.userId, userId), isNull(cloudPurgeTable.doneAt)))
      .limit(1);
    if (pending) return;
    await this.db.insert(cloudPurgeTable).values({ userId });
  }

  /**
   * Only jobs whose user row is really gone. The enqueue happens in a `before` delete hook and
   * the HTTP driver has no transaction spanning it and the delete, so a delete that fails after
   * the enqueue must never get a live account's objects purged.
   */
  async nextPending(limit: number): Promise<PurgeJob[]> {
    const rows = await this.db
      .select()
      .from(cloudPurgeTable)
      .where(
        and(
          isNull(cloudPurgeTable.doneAt),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(userTable)
              .where(eq(userTable.id, cloudPurgeTable.userId)),
          ),
        ),
      )
      .orderBy(cloudPurgeTable.createdAt)
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      attempts: r.attempts,
      createdAt: r.createdAt,
    }));
  }

  async markAttempt(id: string, error: string | null): Promise<void> {
    await this.db
      .update(cloudPurgeTable)
      .set({ attempts: sql`${cloudPurgeTable.attempts} + 1`, lastError: error })
      .where(eq(cloudPurgeTable.id, id));
  }

  async markDone(id: string): Promise<void> {
    await this.db
      .update(cloudPurgeTable)
      .set({ doneAt: new Date() })
      .where(eq(cloudPurgeTable.id, id));
  }
}
