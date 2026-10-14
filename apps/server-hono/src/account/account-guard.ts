import type { AccountDeletion } from "@kaipu/domain/repositories";
import { ORPCError } from "@orpc/server";

/** Same window Better Auth uses for its own sensitive actions (`session.freshAge`, 1 day). */
export const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * A deactivated account (deletion scheduled) may only read its deletion status, restore, or sign
 * out. Everything else — uploads, downloads, the catalog, and later share links — is refused with
 * a FORBIDDEN whose `data.kind` clients switch on to show the "scheduled for deletion" screen.
 */
export function accountDeletionScheduledError(
  deletion: AccountDeletion,
): ORPCError<"FORBIDDEN", { kind: "account-deletion-scheduled"; scheduledAt: string }> {
  return new ORPCError("FORBIDDEN", {
    message: "This account is scheduled for deletion. Restore it to continue.",
    data: { kind: "account-deletion-scheduled", scheduledAt: deletion.scheduledAt.toISOString() },
  });
}

export function assertAccountActive(deletion: AccountDeletion | null): void {
  if (deletion) throw accountDeletionScheduledError(deletion);
}

/** Requesting deletion needs a recent sign-in, like Better Auth's own delete-user did. */
export function assertFreshSession(sessionCreatedAt: Date, now: Date): void {
  if (now.getTime() - sessionCreatedAt.getTime() > FRESH_SESSION_MS) {
    throw new ORPCError("FORBIDDEN", {
      message: "Sign in again to delete your account",
      data: { kind: "session-not-fresh" },
    });
  }
}
