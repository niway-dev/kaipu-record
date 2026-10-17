/**
 * What closing the main window means on each platform, kept free of Electron so
 * it can be tested on its own.
 *
 *  - macOS: closing the window closes it; the app lives on in the menu bar and
 *    the Dock brings the window back.
 *  - Windows: closing the window hides it; the app lives on in the tray, as
 *    Windows tray apps do. Only a real quit (tray Quit, the updater's install,
 *    anything that goes through `app.quit()`) lets the window close.
 *  - Linux: closing the window closes it, and with no window left the app quits.
 */

export interface CloseContext {
  platform: NodeJS.Platform;
  /** The app is quitting: `before-quit` passed every guard. */
  isQuitting: boolean;
  /** A close guard (recording or export in progress) already prevented this close. */
  guardTookOver: boolean;
}

/**
 * `"hide"`: prevent the close and hide the window instead. `"close"`: do not
 * intercept — the event proceeds as the earlier listeners left it (closed, or
 * held by a guard's confirmation).
 */
export function closeAction({
  platform,
  isQuitting,
  guardTookOver,
}: CloseContext): "close" | "hide" {
  if (guardTookOver || isQuitting) return "close";
  return platform === "win32" ? "hide" : "close";
}

/** Whether the app quits once its last window is closed. */
export function shouldQuitOnAllWindowsClosed(platform: NodeJS.Platform): boolean {
  return platform === "linux";
}

/**
 * Apply `closeAction` to a `close` event: when it says hide, prevent the close
 * and call `hide`. Returns whether the window was hidden.
 */
export function handleMainWindowClose(
  event: { preventDefault(): void },
  context: CloseContext,
  hide: () => void,
): boolean {
  if (closeAction(context) !== "hide") return false;
  event.preventDefault();
  hide();
  return true;
}
