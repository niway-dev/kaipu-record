import { useCallback, useRef, useSyncExternalStore } from "react";
import type { AppSettings } from "@shared/types";

/**
 * The window's copy of the app settings (ADR 0063).
 *
 * Main broadcasts the full effective `AppSettings` to every window on each change, and the
 * preload opens one `ipcRenderer` listener per `onSettingsChanged` call. A hook that listened
 * for itself put a dozen listeners on the main window, past Node's default of ten, which warns
 * `MaxListenersExceededWarning`. So this module owns the window's ONLY `onSettingsChanged`
 * subscription and the ONLY startup `getSettings()`; every consumer reads from here and a
 * test fails if another file calls `onSettingsChanged` or the bridge's `getSettings`
 * (`settings-store-usage.test.ts`).
 *
 * It starts on first use (a subscribe, a load or an update), not at import, and then keeps its
 * one listener for the window's lifetime however many consumers come and go: the consumers are
 * a plain `Set` in here. Until the first read lands the value is `null`.
 *
 * A broadcast that lands before the first read resolves wins: it is newer than the file the
 * read saw, so the late read is dropped.
 *
 * Add a consumer with `useSettings` (React) or `subscribeSettings` (anything else). Never call
 * `window.electronAPI.onSettingsChanged` from the renderer.
 */

type SettingsListener = (settings: AppSettings) => void;

let current: AppSettings | null = null;
/** Counts every value the store took (a broadcast, a read, a write's answer). */
let revision = 0;
let ipcOff: (() => void) | null = null;
let ipcOpen = false;
let firstRead: Promise<AppSettings> | null = null;
const listeners = new Set<SettingsListener>();

function publish(next: AppSettings): void {
  current = next;
  revision += 1;
  // A copy: a consumer may unsubscribe (or subscribe) while it is being told.
  for (const listener of [...listeners]) listener(next);
}

/** Opens the window's one `settings:changed` listener, once. */
function openIpc(): void {
  if (ipcOpen) return;
  ipcOpen = true;
  // Optional chaining: a few renderer tests hand over a partial `electronAPI`.
  ipcOff = window.electronAPI.onSettingsChanged?.(publish) ?? null;
}

/**
 * The one startup read. Resolves with the newest value the store holds, which is the read's
 * own unless a broadcast arrived first. A failed read rejects (unless a broadcast already gave
 * a value) and clears itself, so a later `loadSettings()` asks main again.
 */
function readOnce(): Promise<AppSettings> {
  if (firstRead) return firstRead;
  const api = window.electronAPI;
  if (!api.getSettings) return Promise.reject(new Error("settings are not available"));
  const revisionAtRequest = revision;
  const read = api.getSettings().then(
    (settings) => {
      if (revision === revisionAtRequest) publish(settings);
      return current ?? settings;
    },
    (error: unknown) => {
      if (firstRead === read) firstRead = null;
      if (current) return current;
      throw error;
    },
  );
  firstRead = read;
  return read;
}

function start(): void {
  const firstStart = !ipcOpen;
  openIpc();
  // The listener first, so nothing that arrives while the read is out is missed.
  if (firstStart) readOnce().catch(() => undefined);
}

/**
 * The settings once the window has them: resolves at once when it already does, otherwise
 * after the one startup read. Rejects when that read failed and nothing newer arrived.
 */
export function loadSettings(): Promise<AppSettings> {
  start();
  return current ? Promise.resolve(current) : readOnce();
}

/** The settings the window holds now, `null` before the first read lands. Starts nothing. */
export function getSettingsSnapshot(): AppSettings | null {
  return current;
}

/**
 * Calls `listener` with the new settings every time the window gets some: the first read, a
 * broadcast, an answer to `updateSettings`. Not called with the value already held; read that
 * with `getSettingsSnapshot`. Returns the unsubscribe. Subscribing never opens another
 * `ipcRenderer` listener.
 */
export function subscribeSettings(listener: SettingsListener): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `subscribeSettings`, plus one call now with the value the window already holds (nothing when
 * it holds none yet: the first read reaches the listener when it lands). The shape of "read on
 * mount, then follow changes", for an effect that applies settings to something outside React.
 */
export function watchSettings(listener: SettingsListener): () => void {
  const off = subscribeSettings(listener);
  if (current) listener(current);
  return off;
}

/**
 * Saves a patch in main and hands main's answer (the new full settings) to every consumer in
 * this window at once, ahead of the broadcast that tells the other windows. When a broadcast
 * landed while the answer was on its way, that broadcast is newer, so the answer is returned
 * but not published (main also sends this window its own change as a broadcast).
 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  start();
  const revisionAtRequest = revision;
  const saved = await window.electronAPI.updateSettings(patch);
  if (revision === revisionAtRequest) publish(saved);
  return saved;
}

/**
 * A value picked from the settings, `null` until the first read lands, and the value at once
 * when the window already has it (no flash of `null`).
 *
 * `selector` must pick, not build: return a field of the settings (or a nested object), never
 * a fresh object or array, which would look changed on every read. Derive anything fresh with
 * `useMemo` from the picked value. Main sends a new object for every field on every broadcast,
 * so a nested pick is a new reference each time; pass `isEqual` to ignore broadcasts that left
 * what you read as it was.
 */
export function useSettings<T>(
  selector: (settings: AppSettings) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T | null {
  const memo = useRef<{
    source: AppSettings;
    selector: (settings: AppSettings) => T;
    value: T;
  } | null>(null);
  const getSnapshot = useCallback((): T | null => {
    const source = current;
    if (!source) return null;
    const previous = memo.current;
    if (previous && previous.source === source && previous.selector === selector) {
      return previous.value;
    }
    const picked = selector(source);
    const value = previous && isEqual(previous.value, picked) ? previous.value : picked;
    memo.current = { source, selector, value };
    return value;
  }, [selector, isEqual]);
  const subscribe = useCallback((onChange: () => void) => subscribeSettings(() => onChange()), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** For tests: how many consumers are subscribed (the window's own listener is not one). */
export function settingsSubscriberCount(): number {
  return listeners.size;
}

/** For tests: the window forgets its value, its consumers and its listener, as a fresh load. */
export function resetSettingsStoreForTests(): void {
  ipcOff?.();
  ipcOff = null;
  ipcOpen = false;
  firstRead = null;
  current = null;
  revision = 0;
  listeners.clear();
}
