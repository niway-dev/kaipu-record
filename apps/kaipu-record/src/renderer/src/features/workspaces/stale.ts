import { STALE_WORKSPACE } from "@shared/types/workspaces";

/**
 * A call that a workspace switch made stale (ADR 0032): refused by main or discarded by the
 * preload. Electron wraps a main-side rejection ("Error invoking remote method …: Error:
 * stale-workspace"), so the marker is matched anywhere in the message.
 */
export function isStaleWorkspaceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_WORKSPACE);
}
