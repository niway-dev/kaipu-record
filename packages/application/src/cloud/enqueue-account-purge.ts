import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";

/**
 * Record the obligation to delete a user's R2 objects. Must run BEFORE the user row is deleted:
 * the cascade removes every database row that knows the account existed, and the queue row is
 * the only memory left. It is idempotent per user — a second call while a job is pending is a
 * no-op, so a retried delete does not stack duplicate jobs. Errors propagate on purpose: the
 * caller (the auth delete hook) must abort the deletion rather than orphan the objects.
 *
 * The purge itself ignores a job whose user still exists, so enqueueing for a deletion that
 * later fails does not destroy a live account's data.
 */
export async function enqueueAccountPurge(params: {
  purge: ICloudPurgeRepository;
  userId: string;
}): Promise<void> {
  await params.purge.enqueue(params.userId);
}
