import type { WebPreferences } from "electron";
import { applyFlagOverride, flagOverridesArg, type FlagOverrides } from "@shared/flag-overrides";

let active: FlagOverrides = {};

type OverridesListener = (overrides: FlagOverrides) => void;
const listeners = new Set<OverridesListener>();

/** Called with the new overrides each time `changeFlagOverride` changes them. */
export function onActiveFlagOverridesChanged(listener: OverridesListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set once at startup, before any window exists. */
export function setActiveFlagOverrides(overrides: FlagOverrides): void {
  active = overrides;
}

export function activeFlagOverrides(): FlagOverrides {
  return active;
}

/**
 * Pin (`true`/`false`) or clear (`null`) one flag while the app runs: the Developer page toggle.
 * Windows created later get the new overrides as their launch argument; the listeners (main
 * broadcasts to the windows already open) hear about it here. Does nothing in a packaged build,
 * for an unknown flag or for a non-boolean value. Returns the overrides now active.
 */
export function changeFlagOverride(
  name: string,
  value: unknown,
  opts: { isPackaged: boolean },
): FlagOverrides {
  const next = applyFlagOverride(active, name, value, opts);
  if (JSON.stringify(next) === JSON.stringify(active)) return active;
  active = next;
  for (const listener of listeners) listener(active);
  return active;
}

/**
 * `webPreferences` for a window that loads the renderer: passes the active feature-flag
 * overrides to its preload, keeping any `additionalArguments` the window already had.
 * With no override active the preferences come back untouched.
 */
export function withFlagOverrides(webPreferences: WebPreferences): WebPreferences {
  if (Object.keys(active).length === 0) return webPreferences;
  return {
    ...webPreferences,
    additionalArguments: [...(webPreferences.additionalArguments ?? []), flagOverridesArg(active)],
  };
}
