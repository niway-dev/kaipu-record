import { app, BrowserWindow } from "electron";
import { AppShutdown, QUIT_DEADLINE_MS } from "./shutdown";

/** The one shutdown sequence of this process. Modules register what they open; `index.ts` begins it. */
export const appShutdown = new AppShutdown({
  deadlineMs: QUIT_DEADLINE_MS,
  log: (message) => console.error(message),
  openWindows: () => BrowserWindow.getAllWindows().map(describeWindow),
  // `app.exit` ends the process at once: no more `close` round trips, no `will-quit`.
  exit: () => app.exit(0),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/**
 * Hook the sequence to the app's lifecycle. `will-quit` means every window closed and the
 * quit is going through, so the deadline is disarmed. A window created after the quit began
 * (a late timer, a renderer-triggered open) is the exact thing that keeps a quit waiting
 * forever: it is destroyed as soon as it exists, and the log says who did it.
 */
export function installAppShutdown(): void {
  app.on("will-quit", () => appShutdown.finish());
  app.on("browser-window-created", (_event, window) => {
    if (!appShutdown.isQuitting()) return;
    console.error(
      `[shutdown] a window was created after the quit began (${describeWindow(window)}); destroying it`,
    );
    // Not inside the creation event itself: let the constructor return first.
    setImmediate(() => {
      if (!window.isDestroyed()) window.destroy();
    });
  });
}

function describeWindow(window: BrowserWindow): string {
  if (window.isDestroyed()) return `#${window.id} destroyed`;
  const contents = window.webContents;
  return (
    `#${window.id} "${window.getTitle()}" ${contents.getURL() || "(no url)"}` +
    ` visible=${window.isVisible()} loading=${contents.isLoading()} crashed=${contents.isCrashed()}`
  );
}
