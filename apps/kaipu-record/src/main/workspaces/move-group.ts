import type {
  MoveItemRef,
  MoveKeptOriginal,
  MoveItemsResult,
  MoveProgress,
  MoveRefusal,
} from "@shared/types/workspaces";

import { MaintenanceError } from "../library/vault-activity";
import { StaleWorkspaceError } from "./gate";

export type SingleMove = (
  item: MoveItemRef,
) => Promise<
  { ok: true; newId: string; keptOriginal?: MoveKeptOriginal } | { ok: false; reason: MoveRefusal }
>;

export interface GroupOptions {
  targetId: string;
  onProgress?(progress: MoveProgress): void;
  /** Checked before each item: true once the user pressed Stop. */
  stopped?(): boolean;
}

/**
 * A group move (ADR 0033, decision 14): N single moves, one after another in the order given
 * (the order on screen), never in parallel. A failure does not stop the rest; Stop lets the
 * move in flight finish and starts no further one. Not a transaction and not journaled: each
 * single move is crash-safe on its own.
 */
export async function runMoveGroup(
  items: readonly MoveItemRef[],
  moveOne: SingleMove,
  options: GroupOptions,
): Promise<MoveItemsResult> {
  const result: MoveItemsResult = {
    targetId: options.targetId,
    moved: [],
    failed: [],
    skipped: [],
  };
  for (const [index, item] of items.entries()) {
    if (options.stopped?.()) {
      result.skipped.push(...items.slice(index).map((rest) => rest.id));
      break;
    }
    options.onProgress?.({ current: index + 1, total: items.length });
    let outcome: Awaited<ReturnType<SingleMove>>;
    try {
      outcome = await moveOne(item);
    } catch (error) {
      console.error(`move of "${item.id}" threw`, error);
      outcome = { ok: false, reason: "io" };
    }
    if (outcome.ok) {
      result.moved.push({
        id: item.id,
        newId: outcome.newId,
        ...(outcome.keptOriginal ? { keptOriginal: outcome.keptOriginal } : {}),
      });
    } else result.failed.push({ id: item.id, reason: outcome.reason });
  }
  return result;
}

/**
 * `resolve` for one group: once it answers null (the target is not connected, or a stalled
 * provider did not answer in time) the rest of the group gets null at once. Each answer costs up
 * to the availability bound of `checkAvailability`, so asking again per item would hold the switch
 * lock for N times that for a target that is not coming back during the run. The bound, from the
 * timeouts in `availability-check.ts`, `sync-state.ts` and `synced-folder.ts`:
 *   - a synced folder: 5 s for the probe + 1 s for the `stat` fallback = 6 s;
 *   - a workspace first detected as plain, detected again: 5 s probe + 2 s `realpath` + 2 s xattr
 *     + 5 s second probe + 1 s `stat` fallback = 15 s. The identity `stat` (1 s) is not on this
 *     path: it is asked only when the detection answers "not synced", and then there is no second
 *     probe.
 */
export function rememberingUnavailable(
  resolve: () => Promise<string | null>,
): () => Promise<string | null> {
  let unavailable = false;
  return async () => {
    if (unavailable) return null;
    const directory = await resolve();
    if (directory === null) unavailable = true;
    return directory;
  };
}

/**
 * Why a group move threw before or around its items: a stale window and a maintenance run are
 * what they say; anything else (a failed read, a full disk) is an I/O failure, never "stale".
 */
export function refusalOfError(error: unknown): MoveRefusal {
  if (error instanceof StaleWorkspaceError) return "stale";
  if (error instanceof MaintenanceError) return "maintenance";
  return "io";
}
