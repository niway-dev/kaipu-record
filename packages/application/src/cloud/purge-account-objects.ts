import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";
import { accountPrefixes } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Remove every object under a deleted account's prefixes. The database rows are
 * already gone (cascade); the queue row is the only memory of the obligation.
 * Jobs past `maxAttempts` are left for an operator (they stay listed as pending).
 *
 * `maxObjects` caps the R2 deletes of one call (one cron tick), shared by every job in it, so a
 * burst of account deletions becomes a steady trickle of R2 calls instead of a spike. A job that
 * runs out of budget stays pending without consuming an attempt; the next tick lists its
 * prefixes again (deleted keys are gone) and carries on. A job is only marked done after a pass
 * that found its prefixes empty within budget.
 */
export async function purgeAccountObjects(params: {
  purge: ICloudPurgeRepository;
  storage: IStorageService;
  limit: number;
  maxAttempts: number;
  maxObjects?: number;
}): Promise<{ done: number; failed: number; deletedObjects: number; unfinished: number }> {
  const jobs = (await params.purge.nextPending(params.limit)).filter(
    (j) => j.attempts < params.maxAttempts,
  );
  let budget = params.maxObjects ?? Number.POSITIVE_INFINITY;
  let done = 0;
  let failed = 0;
  let deletedObjects = 0;
  let unfinished = 0;
  for (const job of jobs) {
    try {
      let exhausted = false;
      for (const prefix of accountPrefixes(job.userId)) {
        let cursor: string | undefined;
        do {
          const page = await params.storage.listObjectKeys(prefix, cursor);
          for (const key of page.keys) {
            if (budget <= 0) {
              exhausted = true;
              break;
            }
            await params.storage.deleteObject(key);
            budget -= 1;
            deletedObjects += 1;
          }
          cursor = exhausted ? undefined : (page.nextCursor ?? undefined);
        } while (cursor);
        if (exhausted) break;
      }
      if (exhausted) {
        unfinished += 1;
        continue;
      }
      await params.purge.markDone(job.id);
      done += 1;
    } catch (err) {
      await params.purge.markAttempt(job.id, err instanceof Error ? err.message : String(err));
      failed += 1;
    }
  }
  return { done, failed, deletedObjects, unfinished };
}
