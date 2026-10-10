import {
  purgeAccountObjects,
  retryPendingDeletes,
  sweepExpiredReservations,
} from "@kaipu/application";
import type { ICloudAssetRepository, ICloudPurgeRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import type { CloudEvent } from "../lib/events";

// PROPOSALS (plan 01 Task 0, NIW2-214 Q12) — not approved. Change them in one place.
export const SWEEP_LIMIT = 50;
export const PURGE_LIMIT = 1;
export const PURGE_MAX_ATTEMPTS = 10;
export const RECONCILE_WINDOW_MS = 60 * 60 * 1000;

export interface CloudSweepDeps {
  assets: ICloudAssetRepository;
  purge: ICloudPurgeRepository;
  /** `null` when R2 is not configured: the run logs `cloud.sweep.failed` and does nothing. */
  storage: IStorageService | null;
  log(event: CloudEvent): void;
  now?: Date;
}

/**
 * One cron invocation (plan 01 Task 11). Every step is idempotent and bounded, so a partial run
 * (Worker CPU limit, transient R2 error) leaves nothing worse than before — the next tick
 * continues. Pure over its dependencies: `scheduled.ts` composes the real ones.
 *
 * Steps: release reservations past ticket expiry + grace, retry `deleting` revisions, drain the
 * account purge queue, reconcile accounts touched in the last hour. Emits `cloud.sweep` with counts
 * only, or `cloud.sweep.failed` with an error name (never a key, URL or message with user data).
 */
export async function runCloudSweep(deps: CloudSweepDeps): Promise<void> {
  const { assets, purge, storage, log } = deps;
  const now = deps.now ?? new Date();
  if (!storage) {
    log({ name: "cloud.sweep.failed", error: "storage-not-configured" });
    return;
  }
  try {
    const swept = await sweepExpiredReservations({ assets, storage, now, limit: SWEEP_LIMIT });
    const deletes = await retryPendingDeletes({ assets, storage, limit: SWEEP_LIMIT });
    const purged = await purgeAccountObjects({
      purge,
      storage,
      limit: PURGE_LIMIT,
      maxAttempts: PURGE_MAX_ATTEMPTS,
    });
    const touched = await assets.listAccountsTouchedSince(
      new Date(now.getTime() - RECONCILE_WINDOW_MS),
      SWEEP_LIMIT,
    );
    for (const userId of touched) await assets.reconcile(userId);
    log({
      name: "cloud.sweep",
      released: swept.released,
      deletedObjects: swept.deletedObjects,
      finishedDeletes: deletes.finished,
      failedDeletes: deletes.failed,
      purged: purged.done,
      purgeFailed: purged.failed,
      reconciled: touched.length,
    });
  } catch (err) {
    log({ name: "cloud.sweep.failed", error: err instanceof Error ? err.name : "unknown" });
    throw err;
  }
}
