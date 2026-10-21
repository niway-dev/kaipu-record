import { enqueueAccountPurge } from "@kaipu/application";
import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";

/**
 * Better Auth `databaseHooks.user.delete.before`. Runs while the user row still exists, before the
 * cascade removes every row that knows which objects the account owns, and queues the R2 purge.
 * It throws when the enqueue fails so the deletion aborts instead of orphaning the objects.
 */
export function enqueuePurgeBeforeUserDelete(
  purge: ICloudPurgeRepository,
): (user: { id: string }) => Promise<void> {
  return async (user) => {
    await enqueueAccountPurge({ purge, userId: user.id });
  };
}
