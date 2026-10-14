/**
 * Account deletion grace period (decision 2026-10-10, NIW2-214). Requesting deletion deactivates
 * the account; the scheduled cloud sweep hard-deletes it once the grace period has passed. Until
 * then the owner can sign in and restore it.
 */
export const ACCOUNT_DELETION_GRACE_DAYS = 7;
export const ACCOUNT_DELETION_GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** The date an account requested for deletion at `requestedAt` is hard-deleted. */
export function accountDeletionDate(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_MS);
}
