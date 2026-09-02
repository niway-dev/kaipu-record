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
  failNextUpload: boolean;
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
    failNextUpload: false,
  };
  return Object.assign(state, {
    async createUploadUrl(key: string) {
      if (state.failNextUpload) {
        state.failNextUpload = false;
        throw new Error("R2 presign failed");
      }
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
  });
}

const INPUT = {
  title: "Demo",
  kind: "recording" as const,
  contentType: "video/webm",
  sizeBytes: 1000,
  durationSeconds: 12,
};

/** Create a recording and simulate the client's PUT actually landing in R2. */
async function createAndUpload(
  repo: ReturnType<typeof makeFakeRepo>,
  storage: ReturnType<typeof makeFakeStorage>,
  userId: string,
) {
  const result = await createRecordingUpload({ repo, storage, userId, input: INPUT });
  storage.existingKeys.add(result.recording.storageKey);
  return result;
}

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
    expect(recording.storageKey).toBe(`videos/u1/${recording.id}.webm`);
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

  it("cleans up the row when presigning fails after the insert", async () => {
    storage.failNextUpload = true;
    await expect(
      createRecordingUpload({ repo, storage, userId: "u1", input: INPUT }),
    ).rejects.toThrow(/R2 presign failed/);
    // No orphaned pending row left behind.
    expect(repo.rows.size).toBe(0);
  });
});

describe("confirmRecording", () => {
  it("flips pending -> ready for the owner once the object exists, null for a stranger", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createAndUpload(repo, storage, "u1");

    expect(await confirmRecording({ repo, storage, userId: "u2", id: recording.id })).toBeNull();
    const ready = await confirmRecording({ repo, storage, userId: "u1", id: recording.id });
    expect(ready?.status).toBe("ready");
  });

  it("refuses to confirm when the object was never uploaded", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    // Not calling createAndUpload's helper: the key never lands in `existingKeys`.
    const { recording } = await createRecordingUpload({
      repo,
      storage,
      userId: "u1",
      input: INPUT,
    });

    await expect(
      confirmRecording({ repo, storage, userId: "u1", id: recording.id }),
    ).rejects.toThrow(/No object was found in storage/);
    expect(repo.rows.get(recording.id)?.status).toBe("pending");
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
  it("signs a download once ready, null for a stranger or a still-pending recording", async () => {
    const repo = makeFakeRepo();
    const storage = makeFakeStorage();
    const { recording } = await createAndUpload(repo, storage, "u1");

    expect(
      await getRecordingDownloadUrl({ repo, storage, userId: "u2", id: recording.id }),
    ).toBeNull();
    expect(
      await getRecordingDownloadUrl({ repo, storage, userId: "u1", id: recording.id }),
    ).toBeNull();

    await confirmRecording({ repo, storage, userId: "u1", id: recording.id });
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
