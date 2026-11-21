/**
 * The mode this process runs in (ADR 0067). Main computes it ONCE at launch, before any window
 * exists, from the stored session and the `adminMode` preference, and calls `setLaunchAdminMode`
 * with the result. Nothing changes it afterwards: a setting or account change only makes a
 * restart pending (`adminModeState`). Windows get it as a launch argument through
 * `withFlagOverrides`, so every renderer reads the same value synchronously from its preload.
 */
let launchMode = false;
let launchModeSet = false;

/** Called once at startup, before any window is created. */
export function setLaunchAdminMode(effective: boolean): void {
  launchMode = effective;
  launchModeSet = true;
}

/** True when this process runs in Admin mode. Fixed for the process once set. */
export function launchAdminMode(): boolean {
  return launchMode;
}

/** True once `setLaunchAdminMode` ran: from then on a window may be created. */
export function isLaunchAdminModeSet(): boolean {
  return launchModeSet;
}
