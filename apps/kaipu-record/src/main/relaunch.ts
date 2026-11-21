/**
 * "Restart now" must not skip the quit guards (a recording or an export in progress asks to be
 * stopped first), and a quit the user cancels must not leave a relaunch behind. So the request is
 * only a flag: `will-quit`, which fires once every window closed, calls `relaunchIfRequested`, and
 * every guard that can be answered Cancel (two in `before-quit`, two on the main window's close)
 * calls `cancelRelaunchRequest`.
 */
let requested = false;

export function requestRelaunchOnQuit(): void {
  requested = true;
}

export function cancelRelaunchRequest(): void {
  requested = false;
}

/** Runs `relaunch` (Electron's `app.relaunch`) when a restart was requested. */
export function relaunchIfRequested(relaunch: () => void): void {
  if (!requested) return;
  requested = false;
  relaunch();
}
