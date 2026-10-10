import { accountDeletionDate } from "@kaipu/domain/constants";
import type {
  AccountDeletion,
  DueAccountDeletion,
  IAccountDeletionRepository,
} from "@kaipu/domain/repositories";
import type { AccountDeletionStatus } from "@kaipu/domain/schemas";

/**
 * Account deletion = soft delete with a grace period (decision 2026-10-10, NIW2-214).
 *
 * 1. `requestAccountDeletion` deactivates the account (schedule row), revokes every session and
 *    emails the date. Nothing is deleted yet, and nothing touches R2 on the request.
 * 2. `restoreAccount` cancels the schedule during the grace period.
 * 3. `finalizeDueAccountDeletions` runs in the cron: it enqueues the R2 purge and hard-deletes the
 *    user row in one statement batch. The R2 objects are then removed by `purgeAccountObjects`,
 *    a bounded number per tick.
 *
 * Local desktop files are never involved: the server has no handle on them.
 */

/** Email side effects. Implementations skip (and log) when email is not configured. */
export interface AccountDeletionNotifier {
  deletionScheduled(to: { email: string; locale: string }, scheduledAt: Date): Promise<void>;
  accountDeleted(to: { email: string; locale: string }): Promise<void>;
}

export function toAccountDeletionStatus(deletion: AccountDeletion | null): AccountDeletionStatus {
  if (!deletion) return { status: "active" };
  return {
    status: "scheduled",
    requestedAt: deletion.requestedAt.toISOString(),
    scheduledAt: deletion.scheduledAt.toISOString(),
  };
}

export async function getAccountDeletionStatus(params: {
  deletions: Pick<IAccountDeletionRepository, "find">;
  userId: string;
}): Promise<AccountDeletionStatus> {
  return toAccountDeletionStatus(await params.deletions.find(params.userId));
}

export async function requestAccountDeletion(params: {
  deletions: Pick<IAccountDeletionRepository, "schedule" | "revokeSessions">;
  notifier: AccountDeletionNotifier;
  user: { id: string; email: string };
  locale: string;
  now: Date;
}): Promise<AccountDeletionStatus & { status: "scheduled" }> {
  const { deletions, notifier, user, locale, now } = params;
  // Schedule first: if anything after this fails, the account is already deactivated (every
  // authenticated route refuses it) and a retry of the request is idempotent.
  const deletion = await deletions.schedule({
    userId: user.id,
    requestedAt: now,
    scheduledAt: accountDeletionDate(now),
    locale,
  });
  await deletions.revokeSessions(user.id);
  try {
    await notifier.deletionScheduled({ email: user.email, locale }, deletion.scheduledAt);
  } catch {
    // The notifier logs its own failure. The deletion is scheduled either way, and the date is
    // in this response; an email outage must not leave the user unsure whether it worked.
  }
  return toAccountDeletionStatus(deletion) as AccountDeletionStatus & { status: "scheduled" };
}

export async function restoreAccount(params: {
  deletions: Pick<IAccountDeletionRepository, "cancel">;
  userId: string;
}): Promise<{ restored: boolean }> {
  return { restored: await params.deletions.cancel(params.userId) };
}

/**
 * Cron step: hard-delete accounts whose grace period is over, at most `limit` per tick. Each
 * account is independent: one failure is counted and retried next tick, the rest continue.
 * No R2 call happens here — `finalize` only enqueues the purge.
 */
export async function finalizeDueAccountDeletions(params: {
  deletions: Pick<IAccountDeletionRepository, "listDue" | "finalize">;
  notifier: AccountDeletionNotifier;
  now: Date;
  limit: number;
}): Promise<{ deleted: number; failed: number }> {
  const due: DueAccountDeletion[] = await params.deletions.listDue(params.now, params.limit);
  let deleted = 0;
  let failed = 0;
  for (const d of due) {
    let finalized: boolean;
    try {
      finalized = await params.deletions.finalize(d.userId, params.now);
    } catch {
      failed += 1;
      continue;
    }
    if (!finalized) continue; // restored between listDue and finalize
    deleted += 1;
    try {
      await params.notifier.accountDeleted({ email: d.email, locale: d.locale });
    } catch {
      // Best effort: the account is gone; the notifier already logged the failure.
    }
  }
  return { deleted, failed };
}
