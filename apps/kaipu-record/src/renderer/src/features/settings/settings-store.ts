import { useCallback, useRef, useSyncExternalStore } from "react";
import type { AppSettings } from "@shared/types";

/**
 * The window's copy of the app settings (ADR 0063).
 *
 * Main broadcasts the full effective `AppSettings` to every window on each change, and the
 * preload opens one `ipcRenderer` listener per `onSettingsChanged` call. A hook that listened
 * for itself put a dozen listeners on the main window, past Node's default of ten, which warns
 * `MaxListenersExceededWarning`. So this module owns the window's ONLY `onSettingsChanged`
 * subscription and the ONLY caller of the bridge's `getSettings()` (one startup read at a
 * time, asked again after a failure, and one more after an update that main rejected); every
 * consumer reads from here and a
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
/**
 * Counts the resets and nothing else. A rejected update compares it to learn whether the store
 * it started in still exists. Not `revision`: a broadcast may land before main fails without
 * broadcasting, and the re-read must still run then.
 */
let generation = 0;
let ipcOff: (() => void) | null = null;
let ipcOpen = false;
let firstRead: Promise<AppSettings> | null = null;
const listeners = new Set<SettingsListener>();

function publish(next: AppSettings): void {
  current = next;
  revision += 1;
  // A copy: a Set visits entries added during iteration, so a consumer that subscribes another
  // while being told would otherwise get that one called for this same publish.
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
 * a value) and clears itself, so the next `loadSettings()` or consumer asks main again.
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
  openIpc();
  // The listener first, so nothing that arrives while the read is out is missed. A read starts
  // whenever the store holds no value and none is out: the first start, and any later one after
  // a failed read, so the next consumer to arrive retries instead of staying on `null`.
  if (!current && !firstRead) readOnce().catch(() => undefined);
}

/**
 * The settings once the window has them: resolves at once when it already does, otherwise
 * after the one startup read. Rejects when that read failed and nothing newer arrived.
 */
export function loadSettings(): Promise<AppSettings> {
  start();
  return current ? Promise.resolve(current) : readOnce();
}

/**
 * How many values the store has taken (a broadcast, a read, a write's answer). A caller that
 * compares it before and after an `updateSettings` that rejected learns whether the store
 * heard from main in between: unchanged means neither a broadcast nor the re-read got through.
 */
export function getSettingsRevision(): number {
  return revision;
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
 * Saves a patch in main and returns main's answer (the new full settings). Main broadcasts the
 * change to every window, this one included, before it replies, so the broadcast normally
 * reaches the consumers first. The answer is published to them only when the store took
 * nothing else while it was on its way; otherwise it is returned but not published, because
 * what the store holds is newer.
 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  start();
  const revisionAtRequest = revision;
  const generationAtRequest = generation;
  try {
    const saved = await window.electronAPI.updateSettings(patch);
    if (revision === revisionAtRequest) publish(saved);
    return saved;
  } catch (error) {
    // Main merges the patch before it persists, applies side effects and broadcasts, so a
    // rejection can leave it holding the new value without having told any window. Ask what it
    // holds, so a control such as the diagnostics switch never reads differently from main.
    // Not when the store was reset meanwhile: that store is gone, and the question would
    // publish into the next one.
    if (generation === generationAtRequest) await resyncFromMain();
    throw error;
  }
}

/**
 * Asks main for its settings and publishes them unless the store took something newer while
 * the question was out. A failed read keeps what the window holds: the caller's own error is
 * the one that matters.
 */
async function resyncFromMain(): Promise<void> {
  const api = window.electronAPI;
  if (!api.getSettings) return;
  const revisionAtRequest = revision;
  try {
    const settings = await api.getSettings();
    if (revision === revisionAtRequest) publish(settings);
  } catch {
    // Nothing newer to show; the window keeps its value.
  }
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

/**
 * For tests: the window forgets its value, its consumers and its listener, as a fresh load.
 * The revision moves forward instead of back to 0: a read or an update answer that was out
 * when this ran carries the old revision, so it is dropped instead of publishing into the next
 * test's store, where a restarted count could match it. A rejected update that settles after
 * this ran skips its re-read of main, which the revision cannot tell apart from a broadcast.
 */
export function resetSettingsStoreForTests(): void {
  ipcOff?.();
  ipcOff = null;
  ipcOpen = false;
  firstRead = null;
  current = null;
  revision += 1;
  listeners.clear();
  generation += 1;
}
