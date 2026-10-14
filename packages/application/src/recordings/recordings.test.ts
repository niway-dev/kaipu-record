import type { CreateRecordingData, IRecordingRepository } from "@kaipu/domain/repositories";
import type { RecordingBase } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";
import { describe, expect, it } from "vitest";

import { deleteRecording } from "./delete-recording";
import { getRecordingDownloadUrl } from "./get-recording-download-url";
import { listRecordings } from "./list-recordings";

/** In-memory recording repo scoped by (id,userId), mirroring the real one. */
function makeFakeRepo(): IRecordingRepository & { rows: Map<string, RecordingBase> } {
  const rows = new Map<string, RecordingBase>();
  const now = new Date();
  return {
    rows,
    async create(data: CreateRecordingData): Promise<RecordingBase> {
      const rec: RecordingBase = {
        ...data,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      rows.set(data.id, rec);
      return rec;
    },
    async markReady(id, userId) {
      const rec = rows.get(id);
      if (!rec || rec.userId !== userId) return null;
      const updated = { ...rec, status: "ready" as const };
      rows.set(id, updated);
      return updated;
    },
    async findById(id, userId) {
      const rec = rows.get(id);
      return rec && rec.userId === userId ? rec : null;
    },
    async findAllByUserId(userId) {
      return [...rows.values()].filter((r) => r.userId === userId);
    },
    async delete(id, userId) {
      const rec = rows.get(id);
      if (!rec || rec.userId !== userId) return null;
      rows.delete(id);
      return rec;
    },
  };
}

/**
 * Fake storage that records the keys it was asked to sign/delete/head.
 * `existingKeys` models which objects actually landed in R2 — tests opt a key
 * in explicitly (e.g. after a simulated successful client PUT) rather than
 * `createUploadUrl` implying the bytes were ever sent.
 */
function makeFakeStorage(): IStorageService & {
  uploads: string[];
  downloads: string[];
  deletes: string[];
  heads: string[];
  existingKeys: Set<string>;
} {
  // `Object.assign` mutates and returns the same `state` object the methods
  // close over, so a test flipping `storage.failNextUpload` afterwards (rather
  // than a plain `{ ...state, ...methods }` copy) is actually seen by them.
  const state = {
    uploads: [] as string[],
    downloads: [] as string[],
    deletes: [] as string[],
    heads: [] as string[],
    existingKeys: new Set<string>(),
  };
  return Object.assign(state, {
    async createUploadUrl(key: string) {
      state.uploads.push(key);
      return `https://r2.example/${key}?sig=up`;
    },
    async createDownloadUrl(key: string) {
      state.downloads.push(key);
      return `https://r2.example/${key}?sig=down`;
    },
    async objectExists(key: string) {
      state.heads.push(key);
      return state.existingKeys.has(key);
    },
    async deleteObject(key: string) {
      state.deletes.push(key);
      state.existingKeys.delete(key);
    },
    async createUploadTicket(key: string) {
      return { url: `https://r2.example/${key}`, headers: {}, expiresAt: new Date() };
    },
    async headObject(key: string) {
      return state.existingKeys.has(key)
        ? { sizeBytes: 0, contentType: null, etag: null, checksumSha256: null }
        : null;
    },
    async listObjectKeys() {
      return { keys: [], nextCursor: null };
    },
  });
}

/** Seed a ready recording owned by `userId` whose object exists in storage. */
async function createAndUpload(
  repo: ReturnType<typeof makeFakeRepo>,
  storage: ReturnType<typeof makeFakeStorage>,
  userId: string,
) {
  const id = crypto.randomUUID();
  const storageKey = `videos/${userId}/${id}.webm`;
  await repo.create({
    id,
    userId,
    kind: "recording",
    title: "Demo",
    storageKey,
    contentType: "video/webm",
    sizeBytes: 1000,
    durationSeconds: 12,
  });
  const recording = await repo.markReady(id, userId);
  if (!recording) throw new Error("seed failed");
  storage.existingKeys.add(storageKey);
  return { recording };
}

describe("listRecordings", () => {
  it("returns only the caller's recordings", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    await createAndUpload(repo, storage, "u1");
    await createAndUpload(repo, storage, "u2");

    const mine = await listRecordings({ repo, userId: "u1" });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.userId).toBe("u1");
  });
});

describe("getRecordingDownloadUrl", () => {
  it("signs a download for the owner, null for a stranger", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createAndUpload(repo, storage, "u1");

    expect(
      await getRecordingDownloadUrl({ repo, storage, userId: "u2", id: recording.id }),
    ).toBeNull();
    const dl = await getRecordingDownloadUrl({ repo, storage, userId: "u1", id: recording.id });
    expect(dl?.downloadUrl).toContain(recording.storageKey);
    expect(storage.downloads).toEqual([recording.storageKey]);
  });
});

describe("deleteRecording", () => {
  it("removes the object then the row; false when not owned", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createAndUpload(repo, storage, "u1");

    expect(await deleteRecording({ repo, storage, userId: "u2", id: recording.id })).toBe(false);
    expect(storage.deletes).toHaveLength(0);

    expect(await deleteRecording({ repo, storage, userId: "u1", id: recording.id })).toBe(true);
    expect(repo.rows.size).toBe(0);
    expect(storage.deletes).toEqual([recording.storageKey]);
  });

  it("leaves the row intact when the storage delete fails, so the call can be retried", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createAndUpload(repo, storage, "u1");
    storage.deleteObject = async () => {
      throw new Error("R2 delete failed");
    };

    await expect(
      deleteRecording({ repo, storage, userId: "u1", id: recording.id }),
    ).rejects.toThrow(/R2 delete failed/);
    // The row survives so the object reference isn't lost — a retry can still find it.
    expect(repo.rows.has(recording.id)).toBe(true);
  });
});
