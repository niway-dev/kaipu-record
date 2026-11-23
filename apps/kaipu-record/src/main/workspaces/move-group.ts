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
 * Why a group move threw before or around its items: a stale window and a maintenance run are
 * what they say; anything else (a failed read, a full disk) is an I/O failure, never "stale".
 */
export function refusalOfError(error: unknown): MoveRefusal {
  if (error instanceof StaleWorkspaceError) return "stale";
  if (error instanceof MaintenanceError) return "maintenance";
  return "io";
}
