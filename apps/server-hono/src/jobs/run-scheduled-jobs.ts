import {
  purgeAccountObjects,
  retryPendingDeletes,
  sweepExpiredReservations,
} from "@kaipu/application";
import type { ICloudAssetRepository, ICloudPurgeRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { logEvent } from "../lib/events";

/** Rows handled per job per run. A backlog drains over several runs instead of one long one. */
export const SWEEP_BATCH = 100;
export const RETRY_DELETES_BATCH = 100;
/** Purging lists and deletes every object of an account, so it gets a smaller batch. */
export const PURGE_BATCH = 5;
export const PURGE_MAX_ATTEMPTS = 5;

export interface ScheduledJobDeps {
  assets: ICloudAssetRepository;
  purge: ICloudPurgeRepository;
  /** Null when R2 is not configured: every job needs it, so each reports a failure. */
  storage: IStorageService | null;
  now: Date;
}

/**
 * The cron entry point. Each job is independent: one throwing never skips the others, and every
 * job is idempotent and bounded, so an overlapping or repeated run is harmless. One `cloud.sweep`
 * line summarises the run; a failed job adds a `cloud.sweep.failed` line naming it.
 *
 * HOOK POINT (orphan R2 key sweep): the upload modules are getting a use case that deletes
 * objects with no revision row. When it lands, add it as a fourth `run(...)` below, with its own
 * bounded batch, and fold its count into the `cloud.sweep` event.
 */
export async function runScheduledJobs(deps: ScheduledJobDeps): Promise<void> {
  const { assets, purge, storage, now } = deps;
  const summary = {
    released: 0,
    deletedObjects: 0,
    finishedDeletes: 0,
    failedDeletes: 0,
    purged: 0,
    purgeFailed: 0,
    reconciled: 0,
  };

  const run = async (job: string, fn: (storage: IStorageService) => Promise<void>) => {
    try {
      if (!storage) throw new Error("Cloud storage is not configured");
      await fn(storage);
    } catch (err) {
      logEvent({
        name: "cloud.sweep.failed",
        job,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  };

  await run("sweep-expired-reservations", async (s) => {
    const r = await sweepExpiredReservations({ assets, storage: s, now, limit: SWEEP_BATCH });
    summary.released = r.released;
    summary.deletedObjects = r.deletedObjects;
  });

  await run("retry-pending-deletes", async (s) => {
    const r = await retryPendingDeletes({ assets, storage: s, limit: RETRY_DELETES_BATCH });
    summary.finishedDeletes = r.finished;
    summary.failedDeletes = r.failed;
  });

  await run("purge-account-objects", async (s) => {
    const r = await purgeAccountObjects({
      purge,
      storage: s,
      limit: PURGE_BATCH,
      maxAttempts: PURGE_MAX_ATTEMPTS,
    });
    summary.purged = r.done;
    summary.purgeFailed = r.failed;
  });

  logEvent({ name: "cloud.sweep", ...summary });
}
