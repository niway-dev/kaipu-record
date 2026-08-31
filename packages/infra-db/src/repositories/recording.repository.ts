import type { CreateRecordingData, IRecordingRepository } from "@kaipu/domain/repositories";
import type { RecordingBase } from "@kaipu/domain/schemas";
import { and, desc, eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { mapRecordingToDomain } from "../mappers/recording.mapper";
import { recordingTable } from "../schema";

export class RecordingRepository implements IRecordingRepository {
  constructor(private db: DatabaseClient) {}

  async create(data: CreateRecordingData): Promise<RecordingBase> {
    const [row] = await this.db
      .insert(recordingTable)
      .values({
        userId: data.userId,
        kind: data.kind,
        title: data.title,
        storageKey: data.storageKey,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
        durationSeconds: data.durationSeconds,
        status: "pending",
      })
      .returning();
    if (!row) throw new Error("Failed to insert recording");
    return mapRecordingToDomain(row);
  }

  async markReady(id: string, userId: string): Promise<RecordingBase | null> {
    const [row] = await this.db
      .update(recordingTable)
      .set({ status: "ready" })
      .where(and(eq(recordingTable.id, id), eq(recordingTable.userId, userId)))
      .returning();
    return row ? mapRecordingToDomain(row) : null;
  }

  async findById(id: string, userId: string): Promise<RecordingBase | null> {
    const results = await this.db
      .select()
      .from(recordingTable)
      .where(and(eq(recordingTable.id, id), eq(recordingTable.userId, userId)))
      .limit(1);
    return results[0] ? mapRecordingToDomain(results[0]) : null;
  }

  async findAllByUserId(userId: string): Promise<RecordingBase[]> {
    const results = await this.db
      .select()
      .from(recordingTable)
      .where(eq(recordingTable.userId, userId))
      .orderBy(desc(recordingTable.createdAt));
    return results.map(mapRecordingToDomain);
  }

  async delete(id: string, userId: string): Promise<RecordingBase | null> {
    const [row] = await this.db
      .delete(recordingTable)
      .where(and(eq(recordingTable.id, id), eq(recordingTable.userId, userId)))
      .returning();
    return row ? mapRecordingToDomain(row) : null;
  }
}
