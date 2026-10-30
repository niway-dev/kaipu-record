import { useSyncExternalStore } from "react";
import type { ReconcileFixResult, ReconcileScanResult } from "@shared/types/library-reconcile";

/**
 * "Check and fix files" (NIW2-561, ADR 0033) in the renderer: the last scan, the dialog and
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
}

const INITIAL: ReconcileState = {
  scan: null,
  scanning: false,
  dialogOpen: false,
  run: { phase: "idle" },
  bannerHidden: false,
};

/** The listed-only set the user already saw; the banner returns when it changes. */
export const LISTED_SEEN_KEY = "kaipu.reconcile.listedSeen";

let state: ReconcileState = INITIAL;
const listeners = new Set<() => void>();
/** The vault folder the automatic check last ran for: at most once per session and folder. */
let checkedPath: string | null = null;

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

/** Scan now (read-only in main). */
export async function rescan(): Promise<void> {
  if (state.scanning) return;
  set({ scanning: true });
  try {
    set({ scan: await window.electronAPI.reconcileScan(), scanning: false });
  } catch (error) {
    set({ scan: { status: "error", message: String(error) }, scanning: false });
  }
}

/**
 * The Library and Home call this on mount: one scan per session, again after the vault
 * folder changed. Main refuses to scan during a recording or an export (`busy`).
 */
export async function checkOnce(): Promise<void> {
  if (isRunning()) return;
  const { path } = await window.electronAPI.getVaultDirectory();
  if (path === checkedPath) return;
  checkedPath = path;
  set({ bannerHidden: false });
  await rescan();
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
    result = await window.electronAPI.reconcileFix();
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
  checkedPath = null;
  listeners.clear();
}
