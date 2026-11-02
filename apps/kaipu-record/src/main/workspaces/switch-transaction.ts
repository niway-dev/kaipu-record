import type {
  WorkspaceBusy,
  WorkspaceStamp,
  WorkspaceSwitchResult,
} from "@shared/types/workspaces";
import type { WorkspaceGate } from "./gate";
import type { Availability, RelocateOutcome } from "./registry";

export interface SwitchDeps {
  gate: WorkspaceGate;
  activeId(): string;
  isKnown(id: string): boolean;
  readOnly(): boolean;
  /** Probes the target folder; resolves its id afterwards (a pending entry may adopt one). */
  availability(id: string): Promise<{ availability: Availability; id: string }>;
  /** What is writing into the active workspace right now, if anything (the LOCKED state). */
  busy(): WorkspaceBusy | null;
  /**
   * Ask every window to flush pending saves, resolve unsaved editors (Save, Discard or
   * Cancel) and close what belongs to the old workspace. False when one cancelled or timed out.
   */
  prepareWindows(): Promise<boolean>;
  /** The switch is off after `prepareWindows`: windows go back to normal. */
  abortWindows(): void;
  /** Dismiss pending quiet-capture toasts and drop their retained bytes (after `persistActive`). */
  dropPendingCaptures(): void;
  /** Store `activeId` and the mirrored `vaultDirectory`. */
  persistActive(id: string): Promise<void>;
  /** Window title, tray, `workspaces:changed` and `library:changed`. */
  afterCommit(stamp: WorkspaceStamp): void;
}

let inFlight = false;

/**
 * The switch transaction (ADR 0032, decision 7). Every switch entry point goes through it.
 * Anything that fails before the commit leaves the old workspace active and unchanged.
 *
 * The windows are asked to prepare BEFORE the gate closes: preparing means flushing an
 * editor's pending save, which is an item-scoped call that must still reach the old
 * workspace. Only then does the gate refuse new calls and wait for the running ones.
 */
export async function switchWorkspace(
  deps: SwitchDeps,
  id: string,
): Promise<WorkspaceSwitchResult> {
  if (deps.readOnly()) return { ok: false, reason: "read-only" };
  if (!deps.isKnown(id)) return { ok: false, reason: "unknown" };
  if (id === deps.activeId()) return { ok: true };
  const busy = deps.busy();
  if (busy) return { ok: false, reason: busy };
  if (inFlight) return { ok: false, reason: "cancelled" };
  inFlight = true;
  try {
    const probed = await deps.availability(id);
    if (probed.availability.state !== "available") return { ok: false, reason: "unavailable" };
    const target = probed.id;

    if (!(await deps.prepareWindows())) {
      deps.abortWindows();
      return { ok: false, reason: "cancelled" };
    }
    // A take may have started while a window was asking about unsaved work.
    const late = deps.busy();
    if (late) {
      deps.abortWindows();
      return { ok: false, reason: late };
    }

    await deps.gate.close();
    try {
      await deps.persistActive(target);
    } catch (error) {
      deps.gate.reopen();
      deps.abortWindows();
      throw error;
    }
    // Only now is the switch certain: a failed persist keeps the old workspace's captures.
    deps.dropPendingCaptures();
    deps.afterCommit(deps.gate.commit(target));
    return { ok: true };
  } finally {
    inFlight = false;
  }
}

/** What a transaction on the active workspace needs from the host (a subset of `SwitchDeps`). */
export type ActiveTransactionDeps = Pick<
  SwitchDeps,
  "gate" | "busy" | "prepareWindows" | "abortWindows" | "dropPendingCaptures" | "afterCommit"
>;

/**
 * The same transaction for a change to the ACTIVE workspace that is not a switch: its folder
 * moved ("Change folder…"). Windows prepare first (a pending save must still reach the old
 * folder), the gate drains, `apply` stores the change, and the generation bumps, so every
 * window re-lists the library from the new folder. A refused or failed `apply` leaves the
 * workspace as it was. Shares the in-flight guard with `switchWorkspace`: they never overlap.
 */
export async function relocateActive(
  deps: ActiveTransactionDeps,
  id: string,
  apply: () => Promise<RelocateOutcome>,
): Promise<RelocateOutcome> {
  const busy = deps.busy();
  if (busy) return { ok: false, reason: busy };
  if (inFlight) return { ok: false, reason: "cancelled" };
  inFlight = true;
  try {
    if (!(await deps.prepareWindows())) {
      deps.abortWindows();
      return { ok: false, reason: "cancelled" };
    }
    // A take may have started while a window was asking about unsaved work.
    const late = deps.busy();
    if (late) {
      deps.abortWindows();
      return { ok: false, reason: late };
    }

    await deps.gate.close();
    let outcome: RelocateOutcome;
    try {
      outcome = await apply();
    } catch (error) {
      deps.gate.reopen();
      deps.abortWindows();
      throw error;
    }
    if (!outcome.ok) {
      deps.gate.reopen();
      deps.abortWindows();
      return outcome;
    }
    deps.dropPendingCaptures();
    deps.afterCommit(deps.gate.commit(id));
    return outcome;
  } finally {
    inFlight = false;
  }
}
