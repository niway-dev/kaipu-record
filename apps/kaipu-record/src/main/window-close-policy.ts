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

/** The parts of Electron's `before-input-event` input that the quit shortcut reads. */
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** True for the repeats the OS sends while the key is held down. */
  isAutoRepeat: boolean;
}

/**
 * Windows: Ctrl+Q quits, alongside the tray menu's Quit. Nothing else binds it
 * there — Electron's default quit role has no accelerator on Windows and the menu
 * bar is hidden. macOS keeps Cmd+Q through its app menu.
 */
export function isQuitShortcut(input: KeyInput, platform: NodeJS.Platform): boolean {
  return (
    platform === "win32" &&
    input.type === "keyDown" &&
    // Holding Ctrl+Q must not fire a second quit while the first one's dialog is up.
    !input.isAutoRepeat &&
    input.key.toLowerCase() === "q" &&
    input.control &&
    !input.alt &&
    !input.shift &&
    !input.meta
  );
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

export interface TrayHintContext {
  platform: NodeJS.Platform;
  /** The one-time hint was already shown on an earlier hide (persisted setting). */
  trayHintShown: boolean;
  /** `Notification.isSupported()`: without notifications the hint cannot be shown. */
  notificationSupported: boolean;
}

/**
 * Whether hiding the main window to the tray shows the one-time "Kaipu keeps running
 * in the tray" notification. Only Windows hides to the tray, and the hint is spent
 * only when it can actually be shown.
 */
export function shouldShowTrayHint({
  platform,
  trayHintShown,
  notificationSupported,
}: TrayHintContext): boolean {
  return platform === "win32" && !trayHintShown && notificationSupported;
}

export interface SecondInstanceContext {
  /** `app.isReady()`: before that there is no window or hub to act on. */
  ready: boolean;
  /** A recording is in progress (`hub.isActive()`). */
  recording: boolean;
}

/**
 * What the running copy does when a second launch hands over to it. During a
 * recording the main window is deliberately hidden, so showing it would burn it
 * into the video: tell the user the app is already recording instead.
 */
export function secondInstanceAction({
  ready,
  recording,
}: SecondInstanceContext): "ignore" | "notify" | "show" {
  if (!ready) return "ignore";
  return recording ? "notify" : "show";
}
