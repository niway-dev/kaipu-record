import type { ICloudPurgeRepository, PurgeJob } from "@kaipu/domain/repositories";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { userTable } from "../schema/auth";
import { cloudPurgeTable } from "../schema/cloud";

export class CloudPurgeRepository implements ICloudPurgeRepository {
  constructor(private db: DatabaseClient) {}

  async enqueue(userId: string): Promise<void> {
    await this.db.insert(cloudPurgeTable).values({ userId });
  }

  /**
   * Pending jobs whose user row is gone. The job is enqueued BEFORE Better Auth deletes the user,
   * so if that delete fails the job must not purge a live account's objects: it stays pending
   * (and consumes no attempts) until the user row really disappears.
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
              .select({ id: userTable.id })
              .from(userTable)
              .where(eq(userTable.id, cloudPurgeTable.userId)),
          ),
        ),
      )
      // Fewest attempts first: a job stuck at maxAttempts must not hold the only slot (limit 1).
      .orderBy(cloudPurgeTable.attempts, cloudPurgeTable.createdAt)
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
