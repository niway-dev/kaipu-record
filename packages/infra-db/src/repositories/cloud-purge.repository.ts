import type { ICloudPurgeRepository, PurgeJob } from "@kaipu/domain/repositories";
import { eq, isNull, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { cloudPurgeTable } from "../schema/cloud";

export class CloudPurgeRepository implements ICloudPurgeRepository {
  constructor(private db: DatabaseClient) {}

  async enqueue(userId: string): Promise<void> {
    await this.db.insert(cloudPurgeTable).values({ userId });
  }

  async nextPending(limit: number): Promise<PurgeJob[]> {
    const rows = await this.db
      .select()
      .from(cloudPurgeTable)
      .where(isNull(cloudPurgeTable.doneAt))
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
