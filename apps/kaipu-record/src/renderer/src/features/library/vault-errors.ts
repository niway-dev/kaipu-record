import { UNREADABLE_RECORD_MARKER, VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";

/**
 * True for an operation main refused because "Check and fix files" is running
 * (maintenance mode, NIW2-561). Nothing was done; the caller says so, and an editor keeps
 * its pending save for `onLibraryMaintenanceEnded`.
 */
export function isMaintenanceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(VAULT_MAINTENANCE_MARKER);
}

/** True for a write main refused because the item's record cannot be read (F9). */
export function isUnreadableRecordError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(UNREADABLE_RECORD_MARKER);
}
