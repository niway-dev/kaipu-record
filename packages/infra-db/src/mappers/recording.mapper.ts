import type { RecordingBase } from "@kaipu/domain/schemas";
import type { recordingTable } from "../schema/recording";

type RecordingRow = typeof recordingTable.$inferSelect;

export function mapRecordingToDomain(row: RecordingRow): RecordingBase {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as RecordingBase["kind"],
    title: row.title,
    storageKey: row.storageKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds,
    status: row.status as RecordingBase["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
