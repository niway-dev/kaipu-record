import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { accountPrefixes, type CloudRevision } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";
import { ticketWindowClosed } from "./ticket-window";

/** Statuses whose revision still owns its object: never touched by this sweep. */
const LIVE: ReadonlySet<CloudRevision["status"]> = new Set(["reserved", "ready", "deleting"]);

/**
 * A v2 key is `<prefix><assetId>/<revisionId>.<ext>` — two segments after the account prefix.
 * Legacy `recording` keys (`videos/<userId>/<id>.<ext>`) have one and are left alone until
 * cloud-01 Task 12 drops that table; anything else unexpected is left alone too.
 */
function isRevisionKey(key: string, prefix: string): boolean {
  return key.slice(prefix.length).split("/").length === 2;
}

/**
 * Defence in depth for F-1 (NIW2-323): reconcile storage against revision rows and delete objects
 * that no live revision backs. The deferral rule in cancel/delete closes the known path; this
 * catches any path not yet known (a crash between claim and delete, a future bug) and bounds a
 * stray object's cost to one sweep interval.
 *
 * Order matters: each page of keys is listed from storage FIRST and its revisions are looked up
 * SECOND. A revision row is inserted before its ticket is signed, so any object that exists at
 * listing time already has its row at lookup time; the reverse order could call a fresh
 * reservation's object an orphan.
 *
 * A key is an orphan when no revision of the account names it, or its revision is `expired` or
 * `deleted` and that revision's ticket window has closed (an open window means the ticket may
 * still write; the next run decides). Bounded by `accountLimit`; idempotent. Scheduling it is
 * NIW2-328's job — pass the handler's single `now`, the same one the other jobs get.
 */
export async function sweepOrphanObjects(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  now: Date;
  since: Date;
  accountLimit: number;
}): Promise<{ accounts: number; deleted: number; skipped: number }> {
  const userIds = await params.assets.listAccountsTouchedSince(params.since, params.accountLimit);
  let deleted = 0;
  let skipped = 0;
  for (const userId of userIds) {
    for (const prefix of accountPrefixes(userId)) {
      let cursor: string | undefined;
      do {
        const page = await params.storage.listObjectKeys(prefix, cursor);
        cursor = page.nextCursor ?? undefined;
        const candidates = page.keys.filter((key) => {
          if (isRevisionKey(key, prefix)) return true;
          skipped += 1;
          return false;
        });
        if (candidates.length === 0) continue;
        const revisions = await params.assets.findRevisionsByStorageKeys(userId, candidates);
        const owner = new Map<string, CloudRevision>();
        for (const revision of revisions) {
          owner.set(revision.storageKey, revision);
          if (revision.thumbnailKey) owner.set(revision.thumbnailKey, revision);
        }
        for (const key of candidates) {
          const revision = owner.get(key);
          if (revision && LIVE.has(revision.status)) continue;
          if (revision && !ticketWindowClosed(revision.ticketExpiresAt, params.now)) {
            skipped += 1;
            continue;
          }
          try {
            await params.storage.deleteObject(key);
            deleted += 1;
          } catch {
            skipped += 1; // the next run retries; one failed key must not stop the sweep
          }
        }
      } while (cursor);
    }
  }
  return { accounts: userIds.length, deleted, skipped };
}
