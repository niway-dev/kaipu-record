import {
  purgeAccountObjects,
  retryPendingDeletes,
  sweepExpiredReservations,
  sweepOrphanObjects,
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
/** R2 deletes the purge may spend per run (one subrequest each); a large account spans runs. */
export const PURGE_MAX_OBJECTS = 1000;
/** Accounts the orphan sweep lists per run; each one costs R2 list calls and a revision lookup. */
export const ORPHAN_ACCOUNT_BATCH = 10;
/**
 * The orphan sweep only visits accounts whose storage row changed within this window. A day is far
 * longer than a ticket window (minutes), so an object skipped because its window was still open
 * is seen again on a later run, while a quiet account costs nothing.
 */
export const ORPHAN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

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
 * line summarises the run, the orphan sweep (NIW2-323) adds its own `cloud.sweep.orphans` line,
 * and a failed job adds a `cloud.sweep.failed` line naming it.
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
    purgeExhausted: false,
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
      maxObjects: PURGE_MAX_OBJECTS,
    });
    summary.purged = r.done;
    summary.purgeFailed = r.failed;
    summary.purgeExhausted = r.exhausted;
  });

  await run("sweep-orphan-objects", async (s) => {
    const r = await sweepOrphanObjects({
      assets,
      storage: s,
      now,
      since: new Date(now.getTime() - ORPHAN_LOOKBACK_MS),
      accountLimit: ORPHAN_ACCOUNT_BATCH,
    });
    logEvent({ name: "cloud.sweep.orphans", ...r });
  });

  logEvent({ name: "cloud.sweep", ...summary });
}
