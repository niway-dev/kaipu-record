import type { RecordingBase, RecordingKind } from "../schemas/recording";

/** Fields needed to attach a new (pending) recording to an account. */
export interface CreateRecordingData {
  /** App-generated id, so the storage key can be built before insert. */
  id: string;
  userId: string;
  kind: RecordingKind;
  title: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number;
}

export interface IRecordingRepository {
  /** Insert a recording owned by `userId` with status `pending`. */
  create(data: CreateRecordingData): Promise<RecordingBase>;
  /** Flip a pending recording to `ready`. Returns null if not found for the user. */
  markReady(id: string, userId: string): Promise<RecordingBase | null>;
  findById(id: string, userId: string): Promise<RecordingBase | null>;
  findAllByUserId(userId: string): Promise<RecordingBase[]>;
  /** Delete the recording and return the removed row (so its object can be cleaned up), or null. */
  delete(id: string, userId: string): Promise<RecordingBase | null>;
}
