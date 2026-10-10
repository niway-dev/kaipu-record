import type { AccountDeletionNotifier } from "@kaipu/application";
import type {
  AccountUsage,
  DueAccountDeletion,
  ICloudAssetRepository,
  ICloudPurgeRepository,
  PurgeJob,
} from "@kaipu/domain/repositories";
import type { CloudRevision } from "@kaipu/domain/schemas";
import type { IStorageService, ObjectMetadata } from "@kaipu/domain/services";
import { describe, expect, it, vi } from "vitest";
import type { CloudEvent } from "../lib/events";
import { runCloudSweep } from "./run-cloud-sweep";

const NOW = new Date("2026-10-09T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function revision(overrides: Partial<CloudRevision>): CloudRevision {
  return {
    revisionId: crypto.randomUUID(),
    assetId: crypto.randomUUID(),
    userId: "u1",
    status: "reserved",
    storageKey: "videos/u1/a/r.mp4",
    thumbnailKey: null,
    ...overrides,
  } as CloudRevision;
}

/** Only the methods the sweep touches; anything else fails loudly. */
function fakes(
  opts: {
    reserved?: CloudRevision[];
    deleting?: CloudRevision[];
    jobs?: PurgeJob[];
    due?: DueAccountDeletion[];
  } = {},
) {
  const released: string[] = [];
  const finished: string[] = [];
  const reconciled: string[] = [];
  const listReservedExpiredBefore = vi.fn(
    async (_before: Date, _limit: number) => opts.reserved ?? [],
  );
  const listAccountsTouchedSince = vi.fn(async (_since: Date, _limit: number) => ["u1", "u2"]);
  const assets = {
    listReservedExpiredBefore,
    async release(_userId: string, revisionId: string) {
      released.push(revisionId);
      return true;
    },
    async listDeleting() {
      return opts.deleting ?? [];
    },
    async finishDelete(_userId: string, revisionId: string) {
      finished.push(revisionId);
      return true;
    },
    listAccountsTouchedSince,
    async reconcile(userId: string) {
      reconciled.push(userId);
      return {} as AccountUsage;
    },
  } as unknown as ICloudAssetRepository;

  const jobs = opts.jobs ?? [];
  const done: string[] = [];
  const purge: ICloudPurgeRepository = {
    async enqueue() {},
    async nextPending(limit) {
      return jobs.filter((j) => !done.includes(j.id)).slice(0, limit);
    },
    async markAttempt() {},
    async markDone(id) {
      done.push(id);
    },
  };

  const objects = new Map<string, ObjectMetadata>();
  const deleted: string[] = [];
  const storage = {
    async headObject(key: string) {
      return objects.get(key) ?? null;
    },
    async deleteObject(key: string) {
      deleted.push(key);
      objects.delete(key);
    },
    async listObjectKeys(prefix: string) {
      return { keys: [...objects.keys()].filter((k) => k.startsWith(prefix)), nextCursor: null };
    },
  } as unknown as IStorageService;

  const due = [...(opts.due ?? [])];
  const finalized: string[] = [];
  const listDue = vi.fn(async (_now: Date, limit: number) => due.slice(0, limit));
  const deletions = {
    listDue,
    async finalize(userId: string) {
      finalized.push(userId);
      due.splice(
        due.findIndex((d) => d.userId === userId),
        1,
      );
      // Mirrors AccountDeletionRepository.finalize: the purge job is enqueued with the delete.
      jobs.push({ id: `job-${userId}`, userId, attempts: 0, createdAt: NOW });
      return true;
    },
  };
  const deletedEmails: string[] = [];
  const notifier: AccountDeletionNotifier = {
    async deletionScheduled() {},
    async accountDeleted(to) {
      deletedEmails.push(to.email);
    },
  };

  const events: CloudEvent[] = [];
  return {
    assets,
    purge,
    deletions,
    notifier,
    finalized,
    deletedEmails,
    listDue,
    storage,
    objects,
    deleted,
    released,
    finished,
    reconciled,
    done,
    events,
    log: (e: CloudEvent) => events.push(e),
    listReservedExpiredBefore,
    listAccountsTouchedSince,
  };
}

const meta = (sizeBytes: number): ObjectMetadata => ({
  sizeBytes,
  contentType: null,
  etag: null,
  checksumSha256: null,
});

describe("runCloudSweep", () => {
  it("logs storage-not-configured and touches nothing when R2 is missing", async () => {
    const f = fakes({ reserved: [revision({})] });
    await runCloudSweep({ ...f, storage: null, now: NOW });
    expect(f.events).toEqual([{ name: "cloud.sweep.failed", error: "storage-not-configured" }]);
    expect(f.released).toEqual([]);
    expect(f.listReservedExpiredBefore).not.toHaveBeenCalled();
  });

  it("runs every step and emits one cloud.sweep event with counts only", async () => {
    const expired = revision({ storageKey: "videos/u1/a/r1.mp4" });
    const deleting = revision({
      status: "deleting",
      storageKey: "videos/u1/b/r2.mp4",
      thumbnailKey: "img/u1/b/r2.jpg",
    });
    const job: PurgeJob = { id: "j1", userId: "gone", attempts: 0, createdAt: NOW };
    const f = fakes({ reserved: [expired], deleting: [deleting], jobs: [job] });
    f.objects.set("videos/u1/a/r1.mp4", meta(10)); // landed without a confirm
    f.objects.set("videos/gone/x/r.mp4", meta(5));
    f.objects.set("img/gone/x/r.jpg", meta(1));

    await runCloudSweep({ ...f, now: NOW });

    expect(f.released).toEqual([expired.revisionId]);
    expect(f.finished).toEqual([deleting.revisionId]);
    expect(f.done).toEqual(["j1"]);
    expect(f.reconciled).toEqual(["u1", "u2"]);
    expect([...f.objects.keys()]).toEqual([]);
    expect(f.events).toEqual([
      {
        name: "cloud.sweep",
        released: 1,
        deletedObjects: 1,
        finishedDeletes: 1,
        failedDeletes: 0,
        purged: 1,
        purgeFailed: 0,
        purgedObjects: 2,
        purgeUnfinished: 0,
        accountsDeleted: 0,
        accountDeletionsFailed: 0,
        reconciled: 2,
      },
    ]);
    // Never a key or URL in the event.
    expect(JSON.stringify(f.events)).not.toMatch(/videos\/|img\/|https?:/);
  });

  it("bounds every step: 50 reservations, reconcile window of one hour", async () => {
    const f = fakes();
    await runCloudSweep({ ...f, now: NOW });
    expect(f.listReservedExpiredBefore).toHaveBeenCalledWith(expect.any(Date), 50);
    expect(f.listAccountsTouchedSince).toHaveBeenCalledWith(new Date(NOW.getTime() - HOUR), 50);
  });

  it("hard-deletes accounts past their grace period and purges them within the R2 budget", async () => {
    const due = (userId: string): DueAccountDeletion => ({
      userId,
      email: `${userId}@example.com`,
      locale: "en",
      requestedAt: new Date(NOW.getTime() - 8 * 24 * HOUR),
      scheduledAt: new Date(NOW.getTime() - 24 * HOUR),
    });
    const f = fakes({ due: [due("gone1"), due("gone2")] });
    for (let i = 0; i < 150; i++) f.objects.set(`videos/gone1/a/${i}.mp4`, meta(1));
    for (let i = 0; i < 100; i++) f.objects.set(`img/gone2/a/${i}.png`, meta(1));

    await runCloudSweep({ ...f, now: NOW });

    expect(f.listDue).toHaveBeenCalledWith(NOW, 10);
    expect(f.finalized).toEqual(["gone1", "gone2"]);
    expect(f.deletedEmails).toEqual(["gone1@example.com", "gone2@example.com"]);
    // 200 R2 deletes per tick at most, however many accounts are waiting.
    expect(f.deleted).toHaveLength(200);
    expect(f.events[0]).toMatchObject({
      name: "cloud.sweep",
      accountsDeleted: 2,
      purged: 1,
      purgedObjects: 200,
      purgeUnfinished: 1,
    });

    await runCloudSweep({ ...f, now: NOW });
    expect(f.objects.size).toBe(0);
    expect(f.done).toEqual(["job-gone1", "job-gone2"]);
    expect(f.events[1]).toMatchObject({ accountsDeleted: 0, purged: 1, purgedObjects: 50 });
  });

  it("is idempotent: a second run over the same state does nothing new", async () => {
    const f = fakes();
    await runCloudSweep({ ...f, now: NOW });
    await runCloudSweep({ ...f, now: NOW });
    expect(f.events.every((e) => e.name === "cloud.sweep" && e.released === 0)).toBe(true);
  });

  it("emits cloud.sweep.failed with the error name and rethrows", async () => {
    const f = fakes();
    const boom = new TypeError("db down: postgres://secret@host");
    (f.assets as unknown as { listDeleting: () => Promise<never> }).listDeleting = async () => {
      throw boom;
    };
    await expect(runCloudSweep({ ...f, now: NOW })).rejects.toBe(boom);
    expect(f.events).toEqual([{ name: "cloud.sweep.failed", error: "TypeError" }]);
  });
});
