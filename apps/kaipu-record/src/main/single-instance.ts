/** The slice of Electron's `app` this helper needs, spelled out (not `Pick<App, …>`) so a
 *  plain test fake satisfies it without matching `app.on`'s dozens of overloads. */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: "second-instance", listener: () => void): unknown;
}

/**
 * Make this process the only Kaipu Record instance for its userData directory.
 *
 * Why this matters: every instance on the same userData shares one Chromium profile, and
 * Chromium's Local Storage is a LevelDB that only one process can lock. A second instance
 * (the installed app auto-launched into the tray + a second click on the .app, or the
 * installed app + `bun dev`, which use the same directory) silently falls back to an
 * in-memory Local Storage: every localStorage read comes back empty — so the onboarding
 * flag is "unset" and the welcome flow shows on every launch — and every write is lost when
 * that process exits. Nothing logs this; the app just looks like it forgot everything.
 *
 * Returns `true` when this process owns the lock (the `second-instance` handler is then
 * registered so a later launch surfaces the running app instead of starting a broken one),
 * `false` when another instance already holds it — in which case `app.quit()` has been
 * requested and the caller must skip all further startup work.
 */
export function claimSingleInstance(app: SingleInstanceApp, onSecondInstance: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", onSecondInstance);
  return true;
}
