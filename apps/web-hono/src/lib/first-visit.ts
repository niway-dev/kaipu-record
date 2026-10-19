const keyFor = (userId: string): string => `kaipu.dashboard-welcome-seen.${userId}`;

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Records that this browser has shown `userId` the first-visit welcome, and says whether this call
 * was the first. Every storage access is guarded: when storage is blocked, full or throws, the
 * answer is `false` (no welcome) rather than a welcome that would come back on every visit.
 * Per user and per browser only; there is no server field in v1.
 */
export function claimFirstVisit(
  userId: string,
  store: KeyValueStore | null = defaultStore(),
): boolean {
  if (!store) return false;
  try {
    if (store.getItem(keyFor(userId)) !== null) return false;
    store.setItem(keyFor(userId), "1");
    return true;
  } catch {
    return false;
  }
}
