import { z } from "zod";

/**
 * Account deletion state, as `GET /me/account-deletion` reports it. `active` is the normal state;
 * `scheduled` means the owner asked for deletion and the account is deactivated until
 * `scheduledAt`, when the cron hard-deletes it. Dates are ISO strings on the wire.
 */
export const accountDeletionStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active") }),
  z.object({
    status: z.literal("scheduled"),
    requestedAt: z.iso.datetime(),
    scheduledAt: z.iso.datetime(),
  }),
]);
export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;

/**
 * Thrown when a deactivated account (deletion scheduled) calls anything other than the
 * status/restore routes. The API maps it to FORBIDDEN with `kind: "account-deletion-scheduled"`.
 */
export class AccountDeletionScheduledError extends Error {
  constructor(readonly scheduledAt: Date) {
    super("This account is scheduled for deletion");
    this.name = "AccountDeletionScheduledError";
  }
}
