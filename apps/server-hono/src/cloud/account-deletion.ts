import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";

/**
 * Better Auth `user.deleteUser.beforeDelete`. Runs before the user row is deleted; the database
 * cascade then removes every cloud row, so this queue entry is the only surviving reference to
 * the account's R2 prefixes. The scheduled sweep drains it (`purgeAccountObjects`).
 *
 * If the enqueue fails the error propagates and Better Auth does NOT delete the user: a deleted
 * account whose objects nobody remembers is worse than a failed delete the user can retry.
 * If the delete fails after a successful enqueue, the purge repository only hands out jobs whose
 * user row is gone, so a live account's objects are never purged.
 */
export function makeBeforeDeleteUser(
  purge: Pick<ICloudPurgeRepository, "enqueue">,
): (user: { id: string }) => Promise<void> {
  return async (user) => {
    try {
      await purge.enqueue(user.id);
    } catch (err) {
      console.error("account deletion refused: could not enqueue the cloud purge", {
        userId: user.id,
        error: err instanceof Error ? err.name : "unknown",
      });
      throw err;
    }
  };
}
