import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";
import { accountPrefixes } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Remove every object under a deleted account's prefixes. The database rows are
 * already gone (cascade); the queue row is the only memory of the obligation.
 * Jobs past `maxAttempts` are left for an operator (they stay listed as pending).
 *
 * Bounded by objects, not only by jobs: once `maxObjects` deletes have been spent the run
 * stops and returns `exhausted: true`. That is not a failure — `attempts` counts errors
 * only — and the next run carries on from whatever is left.
 *
 * Each prefix is re-listed from the start until a listing comes back empty: everything a
 * listing returns is deleted, so the next one holds what remains (including an object a late
 * PUT landed meanwhile). A job is marked done only after an empty listing of every prefix.
 */
export async function purgeAccountObjects(params: {
  purge: ICloudPurgeRepository;
  storage: IStorageService;
  limit: number;
  maxAttempts: number;
  maxObjects: number;
}): Promise<{ done: number; failed: number; exhausted: boolean }> {
  const jobs = (await params.purge.nextPending(params.limit)).filter(
    (j) => j.attempts < params.maxAttempts,
  );
  let done = 0;
  let failed = 0;
  let budget = params.maxObjects;
  for (const job of jobs) {
    try {
      let complete = true;
      for (const prefix of accountPrefixes(job.userId)) {
        let keys = (await params.storage.listObjectKeys(prefix)).keys;
        while (keys.length > 0) {
          for (const key of keys) {
            if (budget === 0) break;
            await params.storage.deleteObject(key);
            budget -= 1;
          }
          if (budget === 0) {
            complete = false;
            break;
          }
          keys = (await params.storage.listObjectKeys(prefix)).keys;
        }
        if (!complete) break;
      }
      if (!complete) return { done, failed, exhausted: true };
      await params.purge.markDone(job.id);
      done += 1;
    } catch (err) {
      await params.purge.markAttempt(job.id, err instanceof Error ? err.message : String(err));
      failed += 1;
    }
  }
  return { done, failed, exhausted: false };
}
