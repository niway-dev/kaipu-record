import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";
import { accountPrefixes } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Remove every object under a deleted account's prefixes. The database rows are
 * already gone (cascade); the queue row is the only memory of the obligation.
 * Jobs past `maxAttempts` are left for an operator (they stay listed as pending).
 */
export async function purgeAccountObjects(params: {
  purge: ICloudPurgeRepository;
  storage: IStorageService;
  limit: number;
  maxAttempts: number;
}): Promise<{ done: number; failed: number }> {
  const jobs = (await params.purge.nextPending(params.limit)).filter(
    (j) => j.attempts < params.maxAttempts,
  );
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      for (const prefix of accountPrefixes(job.userId)) {
        let cursor: string | undefined;
        do {
          const page = await params.storage.listObjectKeys(prefix, cursor);
          for (const key of page.keys) await params.storage.deleteObject(key);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      await params.purge.markDone(job.id);
      done += 1;
    } catch (err) {
      await params.purge.markAttempt(job.id, err instanceof Error ? err.message : String(err));
      failed += 1;
    }
  }
  return { done, failed };
}
