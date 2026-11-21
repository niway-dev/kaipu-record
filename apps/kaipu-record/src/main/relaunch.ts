/**
 * "Restart now" must not skip the quit guards (a recording or an export in progress asks to be
 * stopped first), and a quit the user cancels must not leave a relaunch behind. So the request is
 * only a flag: `before-quit` calls `relaunchIfRequested` once every guard has passed, and the two
 * guards that can be answered Cancel call `cancelRelaunchRequest`.
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
