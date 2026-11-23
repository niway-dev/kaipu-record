import type { Availability } from "./registry";
import { boundedProbe, SYNCED_PROBE_TIMEOUT_MS, type SyncStates } from "./sync-state";

/** What the check needs from the registry and the file system (injected so a test can stall them). */
export interface AvailabilityDeps {
  reg: {
    get(id: string): { id: string; path: string } | undefined;
    availability(id: string): Promise<{ availability: Availability; id: string }>;
  };
  syncStates: SyncStates;
  /** One `stat`, true for a folder. */
  isDirectory(path: string): Promise<boolean>;
  /** The bound on a provider that does not answer. */
  probeMs?: number;
}

type Checked = { availability: Availability; id: string };

/**
 * The availability check, bounded for a synced workspace: a provider that does not answer
 * must never hang the switcher, a capture or a move, and the check never lists the provider's
 * root (spec, Availability and Synced folders). Unanswered, a folder that `stat` still sees is
 * available under its registered id, unverified; one that `stat` cannot see is missing.
 *
 * A workspace detected as plain while its identity file was missing is bounded too: it may be a
 * synced folder whose mount is up but stalled, and an unbounded wait there is the hang this
 * check exists to prevent.
 *
 * Checks of one workspace run side by side (the switcher, a capture, a move). Only the newest
 * one may change the unverified flag: an older check that finishes late must not undo, or
 * redo, what a newer one learned.
 */
export async function checkAvailability(
  deps: AvailabilityDeps,
  requestedId: string,
): Promise<Checked> {
  const { reg, syncStates } = deps;
  const probeMs = deps.probeMs ?? SYNCED_PROBE_TIMEOUT_MS;
  const check = syncStates.beginCheck(requestedId);
  const current = (): boolean => syncStates.isCurrentCheck(requestedId, check);
  // The id the registry knows the entry by now: a pending entry adopts its folder's own id the
  // first time it is checked, and every later ask uses the adopted one.
  let id = requestedId;
  let entry = reg.get(id);
  let answered: Checked | null | undefined;
  if (!entry || syncStates.of(entry) === null) {
    syncStates.answered(id); // relocated to a plain folder: nothing is left to verify
    const provisional = entry !== undefined && syncStates.needsRecheck(id);
    const plain = provisional
      ? await boundedProbe(reg.availability(id), null, probeMs)
      : await reg.availability(id);
    if (plain) {
      syncStates.rekey(id, plain.id); // a pending entry may have adopted its folder's id
      // "Not synced" was decided while the folder had no identity file to ask about (the mount
      // was not up at launch). Now it is there, so ask again: a synced folder must not keep
      // hard links and in-folder staging for the whole session.
      if (
        !entry ||
        plain.availability.state !== "available" ||
        !syncStates.needsRecheck(plain.id)
      ) {
        return plain;
      }
      id = plain.id;
      entry = reg.get(id) ?? entry;
      if ((await syncStates.refresh(entry)) === null) return plain;
    } else {
      answered = null; // the folder did not answer within the bound: handled like a synced one
    }
  }
  if (answered === undefined) answered = await boundedProbe(reg.availability(id), null, probeMs);
  if (answered) {
    syncStates.rekey(id, answered.id); // the entry may have adopted its folder's id
    if (current()) syncStates.answered(answered.id);
    return answered;
  }
  const folder = entry?.path;
  const seen =
    folder === undefined ? false : await boundedProbe(deps.isDirectory(folder), false, 1_000);
  if (!seen) return { availability: { state: "unavailable", reason: "missing" }, id };
  if (current()) syncStates.markUnverified(id);
  return { availability: { state: "available" }, id };
}
