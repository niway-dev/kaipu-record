import type { WorkspaceView } from "@shared/types/workspaces";
import { deriveInitials } from "./identity";
import type { Availability, WorkspaceEntry } from "./registry";

/** The drive a macOS path lives on (`/Volumes/<name>/…`), or null for this Mac's own disk. */
export function volumeOf(path: string): string | null {
  const match = /^\/Volumes\/([^/]+)/.exec(path);
  return match ? match[1]! : null;
}

export function toWorkspaceView(
  entry: WorkspaceEntry,
  availability: Availability,
  itemCount: number | null,
): WorkspaceView {
  return {
    id: entry.id,
    name: entry.name,
    color: entry.color,
    initials: entry.initials ?? deriveInitials(entry.name),
    path: entry.path,
    volume: volumeOf(entry.path),
    state: availability.state,
    ...(availability.state === "unavailable" ? { reason: availability.reason } : {}),
    itemCount: availability.state === "available" ? itemCount : null,
  };
}
