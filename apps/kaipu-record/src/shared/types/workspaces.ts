import type { TagColor } from "@kaipu/domain/constants";

/**
 * Workspaces (ADR 0032): separate libraries, one active at a time. Types only, so the
 * preload bundle can import this file (see the `src/shared` rule in CLAUDE.md).
 */

/** What every item-scoped call is made under; main refuses a call whose stamp is not the active one. */
export interface WorkspaceStamp {
  workspaceId: string;
  /** Bumped by main in the last step of every switch. */
  generation: number;
}

/** Why a registered workspace cannot be used right now. */
export type WorkspaceUnavailableReason =
  /** The folder is gone: an unplugged drive or a deleted folder. */
  | "missing"
  /** `.kaipu/workspace/identity.json` exists but cannot be read or parsed. */
  | "unreadable"
  /** Another workspace's identity is in that folder. */
  | "different";

/** Why a switch did not happen. */
export type WorkspaceSwitchRefusal =
  /** A recording or an export is writing into the active workspace (the LOCKED state). */
  | "recording"
  | "exporting"
  /** The target is not connected. */
  | "unavailable"
  /** A window said no (Cancel on an unsaved editor) or did not answer in time. */
  | "cancelled"
  /** The id is not registered. */
  | "unknown"
  /** preferences.json could not be parsed: nothing is written until the next launch. */
  | "read-only";

export interface WorkspaceView {
  id: string;
  name: string;
  color: TagColor;
  /** One or two characters for the tile. */
  initials: string;
  path: string;
  /** The volume name for a folder under /Volumes, else null (this Mac's disk). */
  volume: string | null;
  state: "available" | "unavailable";
  reason?: WorkspaceUnavailableReason;
  /** Local item count, only for the active workspace (null when it was not listed). */
  itemCount: number | null;
}

/** `workspaces:list` (and the `workspaces:changed` broadcast). */
export interface WorkspacesState {
  activeId: string;
  generation: number;
  /** The one-time "New: workspaces" hint was dismissed (or a workspace was added). */
  hintDismissed: boolean;
  /** A recording or export is running: switching is locked. */
  busy: "recording" | "exporting" | null;
  /** preferences.json did not parse: the app runs as before and changes nothing on disk. */
  readOnly: boolean;
  workspaces: WorkspaceView[];
}

export type WorkspaceSwitchResult = { ok: true } | { ok: false; reason: WorkspaceSwitchRefusal };

export type WorkspaceAddResult =
  | { ok: true; workspace: WorkspaceView }
  | { ok: false; reason: "cancelled" | "not-writable" | "read-only" };

export type WorkspaceRemoveResult =
  | { ok: true }
  | { ok: false; reason: "active" | "last" | "unknown" | "read-only" };

/** Main → window `workspaces:prepare`: flush, ask about unsaved work, close editors. */
export interface WorkspacePrepareRequest {
  requestId: number;
}

/** Window → main `workspaces:prepare-result`. */
export interface WorkspacePrepareResult {
  requestId: number;
  ok: boolean;
}

/** The message main rejects a stale item-scoped call with (ADR 0032, decision 6). */
export const STALE_WORKSPACE = "stale-workspace";
