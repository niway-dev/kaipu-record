/**
 * Structured operational events. One JSON line per event on stdout, captured by
 * Workers observability (`observability.enabled` in wrangler.jsonc).
 *
 * Rule: ids, counts, byte totals and error names only. NEVER a presigned URL, a
 * session token, a storage key or a user-chosen title.
 */
export type CloudEvent =
  | {
      name: "cloud.intent.created";
      userId: string;
      assetId: string;
      revisionId: string;
      reservedBytes: number;
    }
  | { name: "cloud.intent.rejected"; userId: string; reason: string; missingBytes?: number }
  | { name: "cloud.confirm.ok"; userId: string; revisionId: string; sizeBytes: number }
  | { name: "cloud.confirm.failed"; userId: string; revisionId: string; reason: string }
  | { name: "cloud.delete.ok"; userId: string; assetId: string }
  | { name: "cloud.delete.failed"; userId: string; assetId: string; error: string }
  | {
      name: "cloud.sweep";
      released: number;
      deletedObjects: number;
      finishedDeletes: number;
      failedDeletes: number;
      purged: number;
      purgeFailed: number;
      purgedObjects: number;
      purgeUnfinished: number;
      accountsDeleted: number;
      accountDeletionsFailed: number;
      reconciled: number;
    }
  | { name: "cloud.sweep.failed"; error: string };

export function logEvent(event: CloudEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}
