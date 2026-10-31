import { useSyncExternalStore } from "react";

/**
 * Whether the export progress widget is minimized to its pill. The user's choice holds for
 * the session — every later export opens the same way — and is kept in sessionStorage so a
 * renderer reload does not undo it. A relaunch starts expanded.
 */
const KEY = "kaipu.exportWidgetMinimized";

function read(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let minimized = read();
const listeners = new Set<() => void>();

export function isExportWidgetMinimized(): boolean {
  return minimized;
}

export function setExportWidgetMinimized(next: boolean): void {
  if (next === minimized) return;
  minimized = next;
  try {
    if (next) window.sessionStorage.setItem(KEY, "1");
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the choice still holds in memory.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useExportWidgetMinimized(): boolean {
  return useSyncExternalStore(subscribe, isExportWidgetMinimized);
}

/** Tests only: back to expanded, and re-read storage as a fresh session would. */
export function __resetExportWidgetForTests(): void {
  window.sessionStorage.removeItem(KEY);
  minimized = read();
  for (const listener of listeners) listener();
}
