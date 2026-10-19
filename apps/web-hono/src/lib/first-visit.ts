type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const keyFor = (userId: string): string => `kaipu.dashboard-welcome-seen.${userId}`;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether this browser already showed the "Your account is ready" welcome to this user. It is a
 * per-browser convenience, not an account fact: when storage is unavailable it says "seen", so a
 * blocked localStorage never turns the welcome into something shown on every visit.
 */
export function hasSeenWelcome(
  userId: string,
  store: KeyValueStore | null = defaultStore(),
): boolean {
  try {
    if (!store) return true;
    return store.getItem(keyFor(userId)) !== null;
  } catch {
    return true;
  }
}

export function markWelcomeSeen(
  userId: string,
  store: KeyValueStore | null = defaultStore(),
): void {
  try {
    store?.setItem(keyFor(userId), String(Date.now()));
  } catch {
    // Storage blocked or full: nothing to remember, and hasSeenWelcome already copes with that.
  }
}
