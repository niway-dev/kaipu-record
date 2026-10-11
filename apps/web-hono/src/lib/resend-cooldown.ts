/**
 * How long the resend-verification button stays disabled after a successful send. Long enough to
 * stop a double-press, short enough that a mail which never arrived can be requested again.
 * Same value as the desktop capacity card.
 */
export const RESEND_COOLDOWN_MS = 2 * 60_000;

export function cooldownRemainingMs(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (now - sentAt));
}

export function withinResendCooldown(sentAt: number | null, now: number): boolean {
  return cooldownRemainingMs(sentAt, now) > 0;
}

const keyFor = (userId: string): string => `kaipu.verification-email-sent-at.${userId}`;

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** When the last verification mail went out for this user, if this browser remembers. */
export function readResendSentAt(
  userId: string,
  store: KeyValueStore | null = defaultStore(),
): number | null {
  try {
    const raw = store?.getItem(keyFor(userId));
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeResendSentAt(
  userId: string,
  sentAt: number,
  store: KeyValueStore | null = defaultStore(),
): void {
  try {
    store?.setItem(keyFor(userId), String(sentAt));
  } catch {
    // Storage can be blocked (private window); the in-memory state still applies for this visit.
  }
}
