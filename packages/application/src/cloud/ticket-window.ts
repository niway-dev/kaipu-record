import { RESERVATION_GRACE_SECONDS } from "@kaipu/domain/constants";

/**
 * True once a revision's presigned PUT ticket can no longer start a write (expiry plus the
 * reservation grace, which also covers an upload that began just before expiry). Until then the
 * object key is still writable by the ticket holder, so deleting the object or releasing its
 * quota would let a later PUT land bytes that no revision accounts for.
 */
export function ticketWindowClosed(ticketExpiresAt: Date, now: Date): boolean {
  return ticketExpiresAt.getTime() + RESERVATION_GRACE_SECONDS * 1000 <= now.getTime();
}
