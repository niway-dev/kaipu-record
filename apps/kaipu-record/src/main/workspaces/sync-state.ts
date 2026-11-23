import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { SyncProvider } from "@shared/types/workspaces";
import { detectSync, syncProviderOfPath, withTimeout } from "./synced-folder";

/**
 * What this Mac knows about each registered workspace's provider (spec, Synced folders: "the
 * kind is stored on the entry and re-detected on every launch"). Detected at launch, when a
 * workspace is added or relocated; until then the path rule answers, which needs no I/O.
 */
export class SyncStates {
  private readonly known = new Map<string, { path: string; sync: SyncProvider | null }>();
  /**
   * Synced workspaces whose last availability check did not answer in time: available under
   * their registered id (an evicted `identity.json` is downloading), but not a move target.
   */
  private readonly unanswered = new Set<string>();

  /**
   * Workspaces detected as "not synced" while their `identity.json` was not there (the mount
   * was not up yet, or the provider had not tagged a fresh file): the xattr fallback could not
   * have said anything, so that "no" is provisional until the folder is seen available.
   */
  private readonly provisional = new Set<string>();

  /**
   * Source of every generation number, for refreshes and checks alike. It only ever goes up and
   * is never reset: a counter that restarted at 1 when a workspace was forgotten and added again
   * would hand a new refresh the number an old, still-running one already holds.
   */
  private clock = 0;

  /** The newest availability check of each workspace (see `beginCheck`). */
  private readonly checks = new Map<string, number>();

  /** The newest detection of each workspace (see `refresh`). */
  private readonly refreshes = new Map<string, number>();

  /**
   * The id each detection that is still running will write under: its own, unless the workspace
   * adopted another one meanwhile (see `rekey`). Entries live only while the detection runs.
   */
  private readonly running = new Map<number, string>();

  constructor(
    private readonly detect: (path: string) => Promise<SyncProvider | null> = detectSync,
    private readonly home: string = homedir(),
    private readonly hasIdentity: (path: string) => Promise<boolean> = identityIsThere,
  ) {}

  /**
   * Detect `entry` again. The detection awaits the provider (seconds when it stalls), so two
   * refreshes of one workspace can overlap, and the workspace can be removed or re-keyed while
   * one runs. Only the newest refresh of an id may write what it learned: an older one that lands
   * late would put the old path back (and lose a detection the path rule cannot reproduce), and
   * one that lands after `forget` or `rekey` would bring back an id that no longer exists.
   * `entry` is read once, up front: the registry mutates a pending entry's id in place.
   */
  async refresh(entry: { id: string; path: string }): Promise<SyncProvider | null> {
    const { id, path } = entry;
    const generation = ++this.clock;
    this.refreshes.set(id, generation);
    this.running.set(generation, id);
    try {
      const sync = await this.detect(path);
      const hasIdentity = sync === null ? await this.hasIdentity(path) : true;
      // The id the workspace has now: a pending one may have adopted its folder's own id while
      // the provider was slow, and the detection belongs to it (`rekey` moved it over).
      const current = this.running.get(generation) ?? id;
      if (this.refreshes.get(current) !== generation) return sync; // superseded: leave the newer answer alone
      this.known.set(current, { path, sync });
      this.unanswered.delete(current); // a new detection (launch, relocation) starts afresh
      if (sync === null && !hasIdentity) this.provisional.add(current);
      else this.provisional.delete(current);
      return sync;
    } finally {
      this.running.delete(generation);
    }
  }

  /**
   * The workspace was detected as plain without its identity file to ask about, so it must be
   * detected again once its folder is available. A plain answer never stays wrong for a session.
   */
  needsRecheck(id: string): boolean {
    return this.provisional.has(id);
  }

  /**
   * An availability check of `id` starts: its number. Checks run side by side, so one that
   * finishes late asks `isCurrentCheck` before it changes what a newer one learned.
   */
  beginCheck(id: string): number {
    const next = ++this.clock;
    this.checks.set(id, next);
    return next;
  }

  /** No newer check of `id` has started since check number `check`. */
  isCurrentCheck(id: string, check: number): boolean {
    return this.checks.get(id) === check;
  }

  /** The workspace's check did not answer in time (`answered(id)` when a later one does). */
  markUnverified(id: string): void {
    this.unanswered.add(id);
  }

  /** The workspace's check answered, or it is not synced (nothing to wait for). */
  answered(id: string): void {
    this.unanswered.delete(id);
  }

  isUnverified(id: string): boolean {
    return this.unanswered.has(id);
  }

  /**
   * A pending workspace adopted its folder's own id (the registry mutates the entry in place):
   * what was learned under the old id belongs to the new one. Without this the new id would
   * fall back to the path rule alone and lose a detection the path cannot reproduce (a Drive
   * folder found through its xattr), and a provisional "plain" would never be asked again.
   */
  rekey(from: string, to: string): void {
    if (from === to) return;
    const hit = this.known.get(from);
    if (hit) this.known.set(to, hit);
    if (this.provisional.has(from)) this.provisional.add(to);
    if (this.unanswered.has(from)) this.unanswered.add(to);
    // A detection of `from` that is still running now belongs to `to`: it would otherwise find
    // `from` forgotten below and drop what it learned, which a path rule cannot reproduce.
    const running = this.refreshes.get(from);
    if (running !== undefined && this.running.get(running) === from) {
      this.running.set(running, to);
      if ((this.refreshes.get(to) ?? 0) < running) this.refreshes.set(to, running);
    }
    this.forget(from);
  }

  /**
   * The workspace was removed from the registry. Whatever refresh or check is still running for
   * it is superseded: its generation is replaced by a newer one instead of being deleted, so
   * the id can be added again and a late result of the old run still cannot pass for current.
   */
  forget(id: string): void {
    this.checks.set(id, ++this.clock);
    this.refreshes.set(id, ++this.clock);
    this.known.delete(id);
    this.provisional.delete(id);
    this.unanswered.delete(id);
  }

  /** The provider of a workspace; a path that changed since the last detection uses the path rule. */
  of(entry: { id: string; path: string }): SyncProvider | null {
    const hit = this.known.get(entry.id);
    if (hit && hit.path === entry.path) return hit.sync;
    return syncProviderOfPath(entry.path, this.home);
  }
}

/** Is Kaipu's own file there? One bounded `stat` (never a read); no answer counts as "not there". */
async function identityIsThere(path: string): Promise<boolean> {
  return withTimeout(
    stat(join(path, ".kaipu", "workspace", "identity.json")).then(() => true),
    1_000,
    false,
  );
}

/** Parent of every synced workspace's scratch folder, in userData. */
export function scratchParent(userData: string): string {
  return join(userData, "workspace-scratch");
}

/** `userData/workspace-scratch/<workspaceId>`: a synced workspace's working files, outside it. */
export function scratchRoot(userData: string, workspaceId: string): string {
  return join(scratchParent(userData), workspaceId);
}

/** Recording and move staging of a synced workspace (instead of `.kaipu/tmp/`). */
export function scratchTmp(userData: string, workspaceId: string): string {
  return join(scratchRoot(userData, workspaceId), "tmp");
}

/**
 * The scratch id for a folder no registered workspace holds yet but the path rule already
 * places inside a cloud provider (a workspace being created or relocated writes its
 * `identity.json` before the registry has the entry). Workspace ids are UUIDs, so it cannot clash.
 */
export const UNREGISTERED_SCRATCH_ID = "unregistered";

/**
 * Where an atomic write to `target` stages its temp file (see `atomicWriteFile`): the scratch
 * folder of the synced workspace whose folder holds `target`, null when that workspace is plain
 * or the path is not in any workspace (userData, Downloads), so those keep their current
 * behavior exactly. A path in no registered workspace but inside a provider's folder stages in
 * the shared unregistered scratch. The innermost registered workspace wins.
 */
export function stagingDirForPath(
  target: string,
  entries: readonly { id: string; path: string }[],
  isSynced: (entry: { id: string; path: string }) => boolean,
  userData: string,
  home: string = homedir(),
): string | null {
  const absolute = resolve(target);
  let owner: { id: string; path: string } | null = null;
  for (const entry of entries) {
    const root = resolve(entry.path);
    const inside = absolute === root || absolute.startsWith(root.endsWith(sep) ? root : root + sep);
    if (inside && (!owner || root.length > resolve(owner.path).length)) owner = entry;
  }
  if (owner) return isSynced(owner) ? scratchTmp(userData, owner.id) : null;
  return syncProviderOfPath(absolute, home) === null
    ? null
    : scratchTmp(userData, UNREGISTERED_SCRATCH_ID);
}

/** The folder of a scratch root that holds drag copies. */
export const SCRATCH_DRAG_DIR = "drag";

/** Drag copies of a synced workspace (instead of `.kaipu/drag/`). */
export function scratchDrag(userData: string, workspaceId: string): string {
  return join(scratchRoot(userData, workspaceId), SCRATCH_DRAG_DIR);
}

/** How long the availability check of a synced workspace may take (spec, Availability). */
export const SYNCED_PROBE_TIMEOUT_MS = 5_000;

/**
 * Bound a probe of a synced workspace: a provider that does not answer must never hang the
 * switcher, a capture start or a move. `onTimeout` decides what an unanswered probe means. A
 * probe that REJECTS (an I/O error from the provider) counts as unanswered too, through the same
 * `withTimeout`: the safe direction, because an unanswered workspace is never a move target, and
 * the error is not thrown at a caller that could only show it as "this workspace is broken".
 */
export function boundedProbe<T>(probe: Promise<T>, onTimeout: T, ms = SYNCED_PROBE_TIMEOUT_MS) {
  return withTimeout(probe, ms, onTimeout);
}

/** What the switcher shows beside a workspace: its item count and the drive it is on. */
export interface WorkspaceFacts {
  count: number | null;
  device: string | null;
}

/**
 * The count and drive of one workspace, asked side by side. A synced workspace shares ONE
 * deadline with its availability check: `remainingMs` is what is left of `SYNCED_PROBE_TIMEOUT_MS`
 * after that check, so a stalled provider costs the switcher one bound, not the sum of four.
 * `skip` (the check never answered, so the folder is unverified) asks nothing. A plain folder's
 * count is not bounded: a slow local scan is not a stalled provider, and a missing count would
 * only hide a number that is really there.
 */
export async function probeWorkspaceFacts(
  options: { synced: boolean; skip: boolean; remainingMs: number },
  probes: { count(): Promise<number | null>; device(): Promise<string | null> },
): Promise<WorkspaceFacts> {
  if (options.skip) return { count: null, device: null };
  const wait = Math.max(0, options.remainingMs);
  const [count, device] = await Promise.all([
    options.synced ? boundedProbe(probes.count(), null, wait) : probes.count(),
    boundedProbe(probes.device(), null, options.synced ? Math.min(wait, 1_000) : 1_000),
  ]);
  return { count, device };
}
