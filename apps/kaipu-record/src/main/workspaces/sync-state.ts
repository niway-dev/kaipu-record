import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

  constructor(
    private readonly detect: (path: string) => Promise<SyncProvider | null> = detectSync,
    private readonly home: string = homedir(),
    private readonly hasIdentity: (path: string) => Promise<boolean> = identityIsThere,
  ) {}

  async refresh(entry: { id: string; path: string }): Promise<SyncProvider | null> {
    const sync = await this.detect(entry.path);
    this.known.set(entry.id, { path: entry.path, sync });
    this.unanswered.delete(entry.id); // a new detection (launch, relocation) starts afresh
    if (sync === null && !(await this.hasIdentity(entry.path))) this.provisional.add(entry.id);
    else this.provisional.delete(entry.id);
    return sync;
  }

  /**
   * The workspace was detected as plain without its identity file to ask about, so it must be
   * detected again once its folder is available. A plain answer never stays wrong for a session.
   */
  needsRecheck(id: string): boolean {
    return this.provisional.has(id);
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
    this.forget(from);
  }

  /** The workspace was removed from the registry. */
  forget(id: string): void {
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
 * switcher, a capture start or a move. `onTimeout` decides what an unanswered probe means.
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
