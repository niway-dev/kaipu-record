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

/**
 * The cloud provider that syncs a workspace folder (spec, Synced folders). Kaipu does not sync
 * to it: the folder is detected by path (and Google Drive's xattr) and labelled.
 */
export type SyncProvider = "google-drive" | "onedrive" | "icloud" | "cloud-provider";

/** What locks the switcher (and the "Move to" menus). */
export type WorkspaceBusy = "recording" | "exporting" | "moving";

/** Why a switch did not happen. */
export type WorkspaceSwitchRefusal =
  /** A recording or an export is writing into the active workspace (the LOCKED state). */
  | "recording"
  | "exporting"
  /** Items are being moved to another workspace (ADR 0033, decision 14). */
  | "moving"
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
  /**
   * The volume the folder is on (`stat.dev`), for an available workspace: a move between two
   * workspaces on the same one is instant, otherwise it copies. Null when not connected.
   */
  device: string | null;
  /** The provider whose synced folder holds this workspace, or null for a plain folder. */
  sync: SyncProvider | null;
}

/** `workspaces:list` (and the `workspaces:changed` broadcast). */
export interface WorkspacesState {
  activeId: string;
  generation: number;
  /** The one-time "New: workspaces" hint was dismissed (or a workspace was added). */
  hintDismissed: boolean;
  /** A recording, an export or a move is running: switching is locked. */
  busy: WorkspaceBusy | null;
  /** preferences.json did not parse: the app runs as before and changes nothing on disk. */
  readOnly: boolean;
  workspaces: WorkspaceView[];
}

export type WorkspaceSwitchResult = { ok: true } | { ok: false; reason: WorkspaceSwitchRefusal };

export type WorkspaceAddResult =
  | { ok: true; workspace: WorkspaceView }
  | { ok: false; reason: "cancelled" | "not-writable" | "read-only" };

/** Where "New workspace" would put its folder, and whether that folder can be used. */
export type LocationState =
  /** Nothing is there: Kaipu creates the folder. */
  | "free"
  /** An empty folder is already there: Kaipu uses it. */
  | "empty"
  /** Something is there (a file, or a folder with content): refused, nothing is touched. */
  | "not-empty"
  /** The folder next to the Default workspace cannot be reached (an unplugged drive). */
  | "parent-missing";

export interface LocationCheck {
  /** The full path of the folder to create, or null when it cannot be worked out. */
  path: string | null;
  state: LocationState;
}

export type WorkspaceCreateRefusal =
  | "read-only"
  | "invalid-name"
  | "invalid-color"
  | "name-taken"
  | "exists"
  | "parent-missing"
  | "not-writable";

/** `workspaces:create`: a new folder next to the Default workspace's, then a switch to it. */
export type WorkspaceCreateResult =
  | {
      ok: true;
      workspace: WorkspaceView;
      /** Creating switches like any other switch; a recording running refuses it. */
      switchResult: WorkspaceSwitchResult;
    }
  | { ok: false; reason: WorkspaceCreateRefusal };

export interface WorkspaceEditRequest {
  id: string;
  name?: string;
  color?: TagColor;
}

export type WorkspaceEditRefusal =
  | "read-only"
  | "unknown"
  | "invalid-name"
  | "invalid-color"
  | "name-taken"
  | "not-writable";

/** `workspaces:edit`: rename and/or recolor. */
export type WorkspaceEditResult =
  | {
      ok: true;
      workspace: WorkspaceView;
      /**
       * False for a workspace that is not connected: the change is in the registry and reaches
       * the folder's `identity.json` when it is reconnected.
       */
      savedToFolder: boolean;
    }
  | { ok: false; reason: WorkspaceEditRefusal };

/**
 * Why "Change folder…" (relocate) did not point a workspace at the picked folder. Relocating
 * never moves or copies files: it only says where the workspace now lives.
 */
export type WorkspaceRelocateRefusal =
  | "read-only"
  | "unknown"
  /** The user closed the folder picker, or a window answered Cancel to an unsaved editor. */
  | "cancelled"
  /** A recording or an export is writing into the active workspace (the LOCKED state). */
  | "recording"
  | "exporting"
  /** A group move is running (part 2): a folder cannot change under it. */
  | "moving"
  /** The picked path is not a folder. */
  | "not-a-folder"
  /** The folder's `identity.json` exists but cannot be read; it is never overwritten. */
  | "unreadable"
  /** Another workspace's identity is in that folder; `workspaceName` names it. */
  | "different"
  /** The folder is already registered as another workspace; `workspaceName` names it. */
  | "already-registered"
  /** `.kaipu/` is there (items' sidecars) but no workspace identity: not this workspace's folder. */
  | "has-items-no-identity"
  /** No `.kaipu` at all: an empty or plain folder. Never adopted silently. */
  | "not-a-workspace"
  /** The registry could not store the new path. */
  | "not-writable";

/** `workspaces:relocate`: the folder picker, then the workspace is pointed at the folder. */
export type WorkspaceRelocateResult =
  | {
      ok: true;
      workspace: WorkspaceView;
      /** The picked folder is the one it already points at: nothing changed, so no "now points" toast. */
      unchanged?: true;
    }
  | {
      ok: false;
      reason: WorkspaceRelocateRefusal;
      /** The other workspace, for `different` and `already-registered`. */
      workspaceName?: string;
    };

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

/** Why an item stayed where it was (ADR 0033): nothing of it changed in either workspace. */
export type MoveRefusal =
  /** No media for that id (moved, renamed or deleted meanwhile), or another item holds it now. */
  | "not-found"
  /** The item's record cannot be read (NIW2-568): it is read-only until it reads again. */
  | "metadata-issue"
  /** A recording or an export is writing: moves wait for it. */
  | "busy"
  /** The destination is not connected, not writable, or its folder holds another workspace. */
  | "target-unavailable"
  /** The item is already in that workspace. */
  | "same-workspace"
  /** The item was dragged out less than 10 seconds ago: the drop may still be reading it. */
  | "dragged-just-now"
  /** The destination drive has no room for a copy. */
  | "no-room"
  /** The destination already holds this very item (a copied folder). */
  | "already-there"
  /** The destination's tag list cannot be read; moving would lose the item's tags. */
  | "tags-unreadable"
  /** The copy did not match the original byte for byte; the original is untouched. */
  | "checksum-mismatch"
  /** A synced workspace's provider offloaded the media: copying it would download it. */
  | "evicted"
  /** "Check and fix files" is running. */
  | "maintenance"
  /** The window's workspace is no longer the active one. */
  | "stale"
  /** A file operation failed; the original is untouched. */
  | "io";

/** One item of `workspaces:move-items`. */
export interface MoveItemRef {
  id: string;
  assetId: string;
}

export interface MoveItemsRequest {
  items: MoveItemRef[];
  targetId: string;
}

/** `workspaces:move-items`: a group of single moves, run one after another (ADR 0033, decision 14). */
export interface MoveItemsResult {
  targetId: string;
  moved: { id: string; newId: string }[];
  failed: { id: string; reason: MoveRefusal }[];
  /**
   * Not started because the user pressed Stop. A group refused as a whole (busy, stale,
   * maintenance) lists every item in `failed` with that reason and leaves this empty.
   */
  skipped: string[];
}

/** Main → window while a group runs: "Moving 3 of 12". */
export interface MoveProgress {
  /** 1-based index of the item being moved. */
  current: number;
  total: number;
}

/** Where the active workspace's folder lives, for the Cloud page (spec, Synced folders). */
export type WorkspaceLocation = SyncProvider | "this-mac" | "external-drive";

/** A cloud item that belongs to no workspace registered on this Mac (decision 23). */
export interface UnassignedCloudItem {
  assetId: string;
  title: string;
  kind: "recording" | "screenshot";
  createdAt: number;
  sizeBytes: number;
  /**
   * The workspace the server names when it is not registered here (deleted, or another
   * Mac's); null when the item never had one (uploaded before workspaces).
   */
  workspaceId: string | null;
}

/** `workspaces:cloud-state`: the Cloud page's view of the active workspace (ADR 0032). */
export interface WorkspaceCloudState {
  workspaceId: string;
  location: WorkspaceLocation;
  signedIn: boolean;
  /**
   * Which Kaipu Cloud items this workspace's Library lists: only its own, or (the migrated
   * Default workspace, until the first "Assign to workspace…") its own and the unassigned.
   */
  filter: "own" | "own-and-unassigned";
  /** The catalog was fetched at least once: the unassigned list is meaningful. */
  catalogKnown: boolean;
  unassigned: UnassignedCloudItem[];
}

export type AssignCloudFailure =
  /** The account has no such cloud item any more. */
  | "not-found"
  /** The target is not a workspace registered on this Mac. */
  | "unknown-workspace"
  | "signed-out";

/** `workspaces:assign-cloud`: per item, whether the server holds it now or it is queued. */
export interface AssignCloudResult {
  assigned: string[];
  /** Offline, or a server without the endpoint yet: retried later, shown assigned meanwhile. */
  queued: string[];
  failed: { assetId: string; reason: AssignCloudFailure }[];
}
