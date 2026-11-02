import type { AssignCloudResult } from "@shared/types/workspaces";
import type { AssignOutcome } from "./assign-client";

export interface AssignCloudDeps {
  registered: ReadonlySet<string>;
  account(): { userId: string; token: string } | null;
  assign(token: string, assetId: string, workspaceId: string): Promise<AssignOutcome>;
  /** The server holds it: that account's cached entry takes the workspace. */
  confirmed(assetId: string, workspaceId: string, userId: string): Promise<void>;
  /** Not answered now: the retry queue sends it later and the Library shows it assigned meanwhile. */
  defer(assetId: string, workspaceId: string, userId: string): Promise<void>;
  /** The user assigned something: the unassigned stop showing in the legacy owner. */
  markAssigned(): Promise<void>;
}

const MAX_ITEMS = 500;

/**
 * "Assign to workspace…" (decision 23): the user gives these cloud items to a workspace. Only
 * ever on this explicit choice; nothing is assigned automatically. Validated here, since the
 * ids come from the renderer.
 */
export async function assignCloudItems(
  assetIds: unknown,
  targetId: unknown,
  deps: AssignCloudDeps,
): Promise<AssignCloudResult> {
  const ids = Array.isArray(assetIds)
    ? [...new Set(assetIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const result: AssignCloudResult = { assigned: [], queued: [], failed: [] };
  const batch = ids.slice(0, MAX_ITEMS);
  if (typeof targetId !== "string" || !deps.registered.has(targetId)) {
    result.failed = batch.map((assetId) => ({ assetId, reason: "unknown-workspace" as const }));
    return result;
  }
  const account = deps.account();
  if (!account) {
    result.failed = batch.map((assetId) => ({ assetId, reason: "signed-out" as const }));
    return result;
  }
  for (const assetId of batch) {
    const outcome = await deps.assign(account.token, assetId, targetId);
    if (outcome === "ok") {
      await deps.confirmed(assetId, targetId, account.userId);
      result.assigned.push(assetId);
    } else if (outcome === "not-found") {
      result.failed.push({ assetId, reason: "not-found" });
    } else {
      await deps.defer(assetId, targetId, account.userId);
      result.queued.push(assetId);
    }
  }
  if (result.assigned.length > 0 || result.queued.length > 0) await deps.markAssigned();
  return result;
}
