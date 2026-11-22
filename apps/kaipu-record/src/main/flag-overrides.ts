import type { WebPreferences } from "electron";
import { adminModeArg } from "@shared/admin-mode";
import { applyFlagOverride, flagOverridesArg, type FlagOverrides } from "@shared/flag-overrides";
import { launchAdminMode } from "./admin-mode";

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
 * `webPreferences` for a window that loads the renderer: passes the launch arguments to its
 * preload, keeping any `additionalArguments` the window already had. Two things ride
 * here, and EVERY window must take them so main and all renderers agree for the whole session:
 * the active feature-flag overrides, and the launch mode (`--kaipu-admin-mode=1` in Admin mode,
 * ADR 0067). With neither the preferences come back untouched.
 */
export function withFlagOverrides(webPreferences: WebPreferences): WebPreferences {
  const extra: string[] = [];
  if (Object.keys(active).length > 0) extra.push(flagOverridesArg(active));
  if (launchAdminMode()) extra.push(adminModeArg(true));
  if (extra.length === 0) return webPreferences;
  return {
    ...webPreferences,
    additionalArguments: [...(webPreferences.additionalArguments ?? []), ...extra],
  };
}
