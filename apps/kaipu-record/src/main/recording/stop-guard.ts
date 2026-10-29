/** The part of `ipcMain` the guard uses. */
export interface StopGuardIpc {
  once(channel: string, listener: () => void): unknown;
  removeListener(channel: string, listener: () => void): unknown;
}

/**
 * Run `proceed` once the recorder reports `channel`, or after `timeoutMs`. Exactly one path
 * runs and the other is cancelled, so no listener outlives the guard and a later recording
 * stop cannot close the window the user got back. `onTimeout` runs before `proceed`, on the
 * timeout path only.
 */
export function proceedWhenRecordingStops(opts: {
  ipc: StopGuardIpc;
  channel: string;
  timeoutMs: number;
  proceed: () => void;
  onTimeout: () => void;
}): void {
  const onStop = (): void => {
    clearTimeout(timer);
    opts.proceed();
  };
  const timer = setTimeout(() => {
    opts.ipc.removeListener(opts.channel, onStop);
    opts.onTimeout();
    opts.proceed();
  }, opts.timeoutMs);
  opts.ipc.once(opts.channel, onStop);
}
