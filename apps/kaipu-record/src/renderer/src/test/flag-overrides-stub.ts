import type { FlagOverrides } from "@shared/flag-overrides";

const listeners = new Set<(overrides: FlagOverrides) => void>();

/** `window.electronAPI.onFlagOverridesChanged` in tests: records the listener, returns an unsubscribe. */
export function stubOnFlagOverridesChanged(
  listener: (overrides: FlagOverrides) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Play main's broadcast after a Developer page toggle: every subscribed window hears the new set. */
export function pushFlagOverrides(overrides: FlagOverrides): void {
  for (const listener of listeners) listener(Object.freeze({ ...overrides }));
}
