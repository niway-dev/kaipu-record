import type { CloudCatalogEntry } from "@shared/types/library-item";

/**
 * Which cloud entries a workspace's Library shows (spec decisions 3, 4 and 23; ADR 0032). The
 * catalog stays per account: this is a view over it, and the cache keeps every entry.
 *
 * The rule (written in the spec, Cloud: server and client):
 * - an entry belongs to its effective workspace: a pending move or assignment of this Mac
 *   (the retry queue), else the server's `workspaceId`;
 * - the active workspace lists the entries that belong to it, plus the cloud copy of any item
 *   whose local file is in it;
 * - an entry that belongs to no workspace (`workspaceId` null: uploaded before workspaces, or
 *   unassigned) is "unassigned". Until the user's first "Assign to workspace…", the legacy
 *   cloud owner (the migrated Default workspace) still lists them, so nothing disappears on
 *   upgrade; from then on they show only under "Unassigned cloud items";
 * - an entry of a workspace not registered on this Mac (deleted, or another Mac's) is listed in
 *   no Library and shows under "Unassigned cloud items" too. Nothing is assigned automatically.
 */
export interface CloudScope {
  activeId: string;
  /** The workspace that lists the unassigned entries until the first assignment. */
  legacyOwnerId: string;
  /** Workspaces registered on this Mac. */
  registered: ReadonlySet<string>;
  /** The user assigned a cloud item once: unassigned entries stop showing in the legacy owner. */
  unassignedHidden: boolean;
  /** assetId → workspace (or null), for assignments the server has not confirmed yet. */
  pending: ReadonlyMap<string, string | null>;
}

/** Where the entry lives, as far as this Mac knows. Null: no workspace. */
export function effectiveWorkspace(
  entry: CloudCatalogEntry,
  pending: ReadonlyMap<string, string | null>,
): string | null {
  if (pending.has(entry.assetId)) return pending.get(entry.assetId) ?? null;
  return entry.workspaceId ?? null;
}

/** The entries the active workspace's Library composes with. */
export function catalogForWorkspace(
  catalog: readonly CloudCatalogEntry[],
  scope: CloudScope,
  localAssets: ReadonlySet<string>,
): CloudCatalogEntry[] {
  return catalog.filter((entry) => {
    if (localAssets.has(entry.assetId)) return true;
    const workspace = effectiveWorkspace(entry, scope.pending);
    if (workspace === null)
      return !scope.unassignedHidden && scope.activeId === scope.legacyOwnerId;
    return workspace === scope.activeId;
  });
}

/** "Unassigned cloud items": no workspace, or one this Mac does not know. From the full catalog. */
export function unassignedEntries(
  catalog: readonly CloudCatalogEntry[],
  scope: Pick<CloudScope, "registered" | "pending">,
): CloudCatalogEntry[] {
  return catalog.filter((entry) => {
    const workspace = effectiveWorkspace(entry, scope.pending);
    return workspace === null || !scope.registered.has(workspace);
  });
}
