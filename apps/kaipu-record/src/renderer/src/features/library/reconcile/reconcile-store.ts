import { useSyncExternalStore } from "react";
import type { ReconcileFixResult, ReconcileScanResult } from "@shared/types/library-reconcile";

/**
 * "Check and fix files" (NIW2-561, ADR 0036) in the renderer: the last scan, the dialog and
 * the Fix all run. Main does the work; this only asks and shows. One store per window.
 */
export type ReconcileRun =
  | { phase: "idle" }
  | { phase: "waiting"; waitingFor: string[] }
  | { phase: "fixing"; done: number; total: number }
  | { phase: "finished"; result: ReconcileFixResult };

export interface ReconcileState {
  scan: ReconcileScanResult | null;
  scanning: boolean;
  dialogOpen: boolean;
  run: ReconcileRun;
  /** "Not now": hidden for the rest of the session. */
  bannerHidden: boolean;
  /** Fixable finding paths not ticked (NIW2-598): unticked by the user, or off by default. Reset by every new scan. */
  skipped: ReadonlySet<string>;
}

const INITIAL: ReconcileState = {
  scan: null,
  scanning: false,
  dialogOpen: false,
  run: { phase: "idle" },
  bannerHidden: false,
  skipped: new Set(),
};

/** The listed-only set the user already saw; the banner returns when it changes. */
export const LISTED_SEEN_KEY = "kaipu.reconcile.listedSeen";

let state: ReconcileState = INITIAL;
const listeners = new Set<() => void>();
/** The vault folder the automatic check last ran for: at most once per session and folder. */
let checkedWorkspace: string | null = null;

function set(patch: Partial<ReconcileState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getReconcileState(): ReconcileState {
  return state;
}

export function subscribeReconcile(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReconcile(): ReconcileState {
  return useSyncExternalStore(subscribeReconcile, getReconcileState);
}

const isRunning = (): boolean => state.run.phase === "waiting" || state.run.phase === "fixing";

/**
 * Findings the user must tick on purpose. A record without an identity in a synced folder may
 * only look that way because the newer version has not arrived yet, so a fix that mints one
 * (`mints`, and every `missing-identity`) is never part of a default "Fix all".
 */
function startsUnticked(scan: ReconcileScanResult): ReadonlySet<string> {
  if (scan.status !== "ok") return new Set();
  return new Set(
    scan.findings.filter((f) => f.kind === "missing-identity" || f.mints).map((f) => f.path),
  );
}

/** Scan now (read-only in main). */
export async function rescan(): Promise<void> {
  if (state.scanning) return;
  set({ scanning: true });
  try {
    // A new list means new choices: whatever was unticked described the old one.
    const scan = await window.electronAPI.reconcileScan();
    set({ scan, scanning: false, skipped: startsUnticked(scan) });
  } catch (error) {
    set({ scan: { status: "error", message: String(error) }, scanning: false });
  }
}

/**
 * The Library and Home call this on mount: one scan per session, again after a switch to
 * another workspace (each is its own folder). Main refuses to scan during a recording or an
 * export (`busy`).
 */
export async function checkOnce(): Promise<void> {
  if (isRunning()) return;
  const workspaces = window.electronAPI.workspaces;
  const workspace = workspaces.activeId() ?? (await workspaces.list()).activeId;
  if (workspace === checkedWorkspace) return;
  checkedWorkspace = workspace;
  set({ bannerHidden: false });
  await rescan();
  // Not checked after all (a recording, an export, a fix, an unreachable folder): the next
  // Library or Home visit asks again.
  if (state.scan?.status !== "ok") checkedWorkspace = null;
}

export function openReconcileDialog(): void {
  set({ dialogOpen: true, run: isRunning() ? state.run : { phase: "idle" } });
  if (!isRunning()) void rescan();
}

/** Dismissible at every point except while files are being fixed. */
export function closeReconcileDialog(): void {
  if (state.run.phase === "fixing") return;
  if (state.run.phase === "waiting") void window.electronAPI.reconcileCancel();
  set({ dialogOpen: false });
}

export function hideBanner(): void {
  if (state.scan?.status === "ok" && state.scan.fixableCount === 0) {
    localStorage.setItem(LISTED_SEEN_KEY, state.scan.listedSignature);
  }
  set({ bannerHidden: true });
}

/** Tick (`fix: true`) or untick these finding paths; a group passes all of its own. */
export function setFixing(paths: readonly string[], fix: boolean): void {
  if (isRunning()) return;
  const skipped = new Set(state.skipped);
  for (const path of paths) {
    if (fix) skipped.delete(path);
    else skipped.add(path);
  }
  set({ skipped });
}

export function cancelWaiting(): void {
  if (state.run.phase === "waiting") void window.electronAPI.reconcileCancel();
}

/** "Fix all": waits for the vault, fixes, then scans again so the banner and list are current. */
export async function fixAll(): Promise<void> {
  if (isRunning()) return;
  set({ run: { phase: "waiting", waitingFor: [] } });
  const stop = window.electronAPI.onReconcileProgress((progress) => {
    if (!isRunning()) return;
    set({ run: progress });
  });
  let result: ReconcileFixResult;
  try {
    result = await window.electronAPI.reconcileFix([...state.skipped]);
  } catch (error) {
    result = { status: "error", message: String(error) };
  } finally {
    stop();
  }
  if (result.status === "cancelled") {
    set({ run: { phase: "idle" } });
    return;
  }
  set({ run: { phase: "finished", result } });
  if (result.status === "done") await rescan();
}

/** What the banner says, or null when it stays hidden. */
export function bannerContent(
  current: ReconcileState,
  seenSignature: string | null,
): { kind: "fixable"; count: number } | { kind: "attention"; count: number } | null {
  if (current.bannerHidden || current.scan?.status !== "ok") return null;
  const { fixableCount, findings, listedSignature } = current.scan;
  if (fixableCount > 0) return { kind: "fixable", count: fixableCount };
  const listed = findings.length;
  if (listed === 0 || listedSignature === seenSignature) return null;
  return { kind: "attention", count: listed };
}

export function __resetReconcileForTests(): void {
  state = INITIAL;
  checkedWorkspace = null;
  listeners.clear();
}
