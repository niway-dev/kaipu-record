import type { CloudCatalogEntry } from "@shared/types/library-item";
import type {
  SyncProvider,
  UnassignedCloudItem,
  WorkspaceCloudState,
  WorkspaceLocation,
} from "@shared/types/workspaces";
import { unassignedEntries, type CloudScope } from "./workspace-filter";

/** Where a folder lives: the provider that syncs it, an external drive, or this Mac's disk. */
export function locationOf(path: string, sync: SyncProvider | null): WorkspaceLocation {
  if (sync) return sync;
  return /^\/Volumes\/[^/]+/.test(path) ? "external-drive" : "this-mac";
}

/** The Cloud page's view of the active workspace. Pure: the caller reads the cache. */
export function buildCloudState(input: {
  active: { id: string; path: string };
  sync: SyncProvider | null;
  signedIn: boolean;
  scope: CloudScope;
  /** The account's full cached catalog; null when signed out or never fetched. */
  catalog: readonly CloudCatalogEntry[] | null;
}): WorkspaceCloudState {
  const { active, scope, catalog } = input;
  const unassigned: UnassignedCloudItem[] = (catalog ? unassignedEntries(catalog, scope) : [])
    .map((entry) => ({
      assetId: entry.assetId,
      title: entry.title,
      kind: entry.kind,
      createdAt: entry.createdAt,
      sizeBytes: entry.sizeBytes,
      workspaceId: entry.workspaceId ?? null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  return {
    workspaceId: active.id,
    location: locationOf(active.path, input.sync),
    signedIn: input.signedIn,
    filter:
      !scope.unassignedHidden && scope.activeId === scope.legacyOwnerId
        ? "own-and-unassigned"
        : "own",
    catalogKnown: catalog !== null,
    unassigned,
  };
}
