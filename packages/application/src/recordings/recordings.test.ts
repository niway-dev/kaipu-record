import type { CreateRecordingData, IRecordingRepository } from "@kaipu/domain/repositories";
import type { RecordingBase } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";
import { beforeEach, describe, expect, it } from "vitest";

import { confirmRecording } from "./confirm-recording";
import { createRecordingUpload } from "./create-recording-upload";
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

/** Fake storage that records the keys it was asked to sign/delete. */
function makeFakeStorage(): IStorageService & {
  uploads: string[];
  downloads: string[];
  deletes: string[];
} {
  const state = { uploads: [] as string[], downloads: [] as string[], deletes: [] as string[] };
  return {
    ...state,
    async createUploadUrl(key) {
      state.uploads.push(key);
      return `https://r2.example/${key}?sig=up`;
    },
    async createDownloadUrl(key) {
      state.downloads.push(key);
      return `https://r2.example/${key}?sig=down`;
    },
    async deleteObject(key) {
      state.deletes.push(key);
    },
  };
}

const INPUT = {
  title: "Demo",
  kind: "recording" as const,
  contentType: "video/webm",
  sizeBytes: 1000,
  durationSeconds: 12,
};

describe("createRecordingUpload", () => {
  let repo: ReturnType<typeof makeFakeRepo>;
  let storage: ReturnType<typeof makeFakeStorage>;
  beforeEach(() => {
    repo = makeFakeRepo();
    storage = makeFakeStorage();
  });

  it("attaches a pending recording to the account and signs its key", async () => {
    const { recording, uploadUrl } = await createRecordingUpload({
      repo,
      storage,
      userId: "u1",
      input: INPUT,
    });

    expect(recording.userId).toBe("u1");
    expect(recording.status).toBe("pending");
    expect(recording.title).toBe("Demo");
    expect(recording.storageKey).toBe(`recordings/u1/${recording.id}.webm`);
    // The presigned key matches the row's stored key.
    expect(storage.uploads).toEqual([recording.storageKey]);
    expect(uploadUrl).toContain(recording.storageKey);
  });

  it("rejects an over-limit upload before touching storage", async () => {
    await expect(
      createRecordingUpload({
        repo,
        storage,
        userId: "u1",
        input: { ...INPUT, sizeBytes: 3 * 1024 * 1024 * 1024 },
      }),
    ).rejects.toThrow(/maximum upload size/);
    expect(repo.rows.size).toBe(0);
    expect(storage.uploads).toHaveLength(0);
  });
});

describe("confirmRecording", () => {
  it("flips pending -> ready for the owner, null otherwise", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createRecordingUpload({
      repo,
      storage,
      userId: "u1",
      input: INPUT,
    });

    expect(await confirmRecording({ repo, userId: "u2", id: recording.id })).toBeNull();
    const ready = await confirmRecording({ repo, userId: "u1", id: recording.id });
    expect(ready?.status).toBe("ready");
  });
});

describe("listRecordings", () => {
  it("returns only the caller's recordings", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    await createRecordingUpload({ repo, storage, userId: "u1", input: INPUT });
    await createRecordingUpload({ repo, storage, userId: "u2", input: INPUT });

    const mine = await listRecordings({ repo, userId: "u1" });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.userId).toBe("u1");
  });
});

describe("getRecordingDownloadUrl", () => {
  it("signs a download for the owner and returns null for a stranger", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createRecordingUpload({
      repo,
      storage,
      userId: "u1",
      input: INPUT,
    });

    expect(
      await getRecordingDownloadUrl({ repo, storage, userId: "u2", id: recording.id }),
    ).toBeNull();
    const dl = await getRecordingDownloadUrl({ repo, storage, userId: "u1", id: recording.id });
    expect(dl?.downloadUrl).toContain(recording.storageKey);
    expect(storage.downloads).toEqual([recording.storageKey]);
  });
});

describe("deleteRecording", () => {
  it("removes the row and its object; false when not owned", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createRecordingUpload({
      repo,
      storage,
      userId: "u1",
      input: INPUT,
    });

    expect(await deleteRecording({ repo, storage, userId: "u2", id: recording.id })).toBe(false);
    expect(storage.deletes).toHaveLength(0);

    expect(await deleteRecording({ repo, storage, userId: "u1", id: recording.id })).toBe(true);
    expect(repo.rows.size).toBe(0);
    expect(storage.deletes).toEqual([recording.storageKey]);
  });
});
