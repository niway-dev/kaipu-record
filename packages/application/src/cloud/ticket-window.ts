import { RESERVATION_GRACE_SECONDS } from "@kaipu/domain/constants";

/**
 * The single definition of "a presigned PUT ticket can no longer write". A ticket is checked for
 * expiry when the request starts, so a PUT that began just before expiry may still be streaming;
 * `RESERVATION_GRACE_SECONDS` covers it. Until the window closes the object key is writable by
 * the ticket holder, so deleting the object or releasing its quota would let a later PUT land
 * bytes that no revision accounts for.
 *
 * Every caller — cancel, delete, the retry job, the sweep and the orphan sweep — derives its
 * boundary from these functions so that no two of them can disagree about the same revision.
 */

/** When the window of a ticket that expires at `ticketExpiresAt` closes. */
export function ticketWindowClosesAt(ticketExpiresAt: Date): Date {
  return new Date(ticketExpiresAt.getTime() + RESERVATION_GRACE_SECONDS * 1000);
}

/**
 * The latest `ticketExpiresAt` whose window is closed at `now`. Repository guards compare the
 * stored column with this value (`ticket_expires_at <= cutoff`) so the check and the transition
 * happen in one statement.
 */
export function ticketWindowCutoff(now: Date): Date {
  return new Date(now.getTime() - RESERVATION_GRACE_SECONDS * 1000);
}

/** True once the ticket can no longer start a write. Closed exactly at expiry + grace. */
export function ticketWindowClosed(ticketExpiresAt: Date, now: Date): boolean {
  return ticketExpiresAt.getTime() <= ticketWindowCutoff(now).getTime();
}
