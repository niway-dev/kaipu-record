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

  constructor(
    private readonly detect: (path: string) => Promise<SyncProvider | null> = detectSync,
    private readonly home: string = homedir(),
  ) {}

  async refresh(entry: { id: string; path: string }): Promise<SyncProvider | null> {
    const sync = await this.detect(entry.path);
    this.known.set(entry.id, { path: entry.path, sync });
    return sync;
  }

  /** The provider of a workspace; a path that changed since the last detection uses the path rule. */
  of(entry: { id: string; path: string }): SyncProvider | null {
    const hit = this.known.get(entry.id);
    if (hit && hit.path === entry.path) return hit.sync;
    return syncProviderOfPath(entry.path, this.home);
  }
}

/** `userData/workspace-scratch/<workspaceId>`: a synced workspace's working files, outside it. */
export function scratchRoot(userData: string, workspaceId: string): string {
  return join(userData, "workspace-scratch", workspaceId);
}

/** Recording and move staging of a synced workspace (instead of `.kaipu/tmp/`). */
export function scratchTmp(userData: string, workspaceId: string): string {
  return join(scratchRoot(userData, workspaceId), "tmp");
}

/** Drag copies of a synced workspace (instead of `.kaipu/drag/`). */
export function scratchDrag(userData: string, workspaceId: string): string {
  return join(scratchRoot(userData, workspaceId), "drag");
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
