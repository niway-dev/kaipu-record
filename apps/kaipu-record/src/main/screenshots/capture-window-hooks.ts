import type { CaptureEnding, CaptureWindowHooks } from "./capture-handler";

/** The slice of the main `BrowserWindow` the hooks use, so tests can pass a fake. */
export interface CaptureMainWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  hide(): void;
  showInactive(): void;
  minimize(): void;
}

export interface CaptureWindowHooksDeps {
  platform?: NodeJS.Platform;
  /** The main window, or null when it was closed (macOS keeps the app alive in the tray). */
  mainWindow(): CaptureMainWindow | null;
  hideCapturePanel(): void;
  /**
   * Hide the previous capture's toast. Only the window: the kept copy-only bytes stay
   * until the capture handler clears them as the new capture starts.
   */
  dismissToast(): void;
  hideCameraBubble(): void;
  restoreCameraBubble(): void;
  /**
   * A take's countdown holds a global Esc. While the capture overlay is open it must not:
   * Esc cancels only the selection (`capture-while-recording`). No-ops without a countdown.
   */
  suspendTakeEscape?(): void;
  resumeTakeEscape?(): void;
  /** Show and focus the main window, recreating it when it was closed. */
  showMainWindow(): void;
  /** Bring the whole app to the front (the editor asked for it). */
  bringAppToFront(): void;
}

/**
 * Window orchestration around a capture (owned by main, which holds the windows): every
 * window of ours leaves the screen before the overlay opens, and comes back afterwards
 * the way the capture ended.
 *
 * - `editor`: the renderer reveals the window itself once the editor shows.
 * - `cancelled`: a window that was up comes back, focused, as before the capture.
 * - `quiet`: the main window stays off screen. `showInactive` would raise it in the window
 *   stack even without focus, covering the app where the user wants to paste. On macOS it
 *   stays hidden (the Dock icon keeps the app reachable); on Windows a window that was up
 *   comes back minimized, because a hidden window has no taskbar button.
 * - `recording`: the overlay started a take; the window stays hidden (the countdown is drawn
 *   on the chosen region) and comes back when the take stops, like any recording.
 *
 * A window that was hidden stays hidden on every path.
 */
export function createCaptureWindowHooks(
  deps: CaptureWindowHooksDeps,
): CaptureWindowHooks & { isCapturing(): boolean } {
  /** Whether the main window was visible before the capture, to restore it after. */
  let wasVisible = false;
  let capturing = false;

  const liveWindow = (): CaptureMainWindow | null => {
    const window = deps.mainWindow();
    return window && !window.isDestroyed() ? window : null;
  };

  return {
    isCapturing: () => capturing,
    beforeCapture: () => {
      capturing = true;
      deps.suspendTakeEscape?.();
      const window = liveWindow();
      wasVisible = window?.isVisible() ?? false;
      // Failure: the last quiet capture's toast is always on top and would land in this shot.
      deps.dismissToast();
      deps.hideCapturePanel();
      window?.hide();
      // The bubble is always-on-top and not content-protected (it is meant to be captured
      // by a *recording*), so it would otherwise sit inside the overlay and the shot.
      deps.hideCameraBubble();
    },
    afterCapture: (ending: CaptureEnding) => {
      capturing = false;
      deps.resumeTakeEscape?.();
      if (wasVisible && ending === "cancelled") deps.showMainWindow();
      if (wasVisible && ending === "quiet" && deps.platform === "win32") {
        // A hidden Windows window has no taskbar button, so the app looks closed.
        // Electron shows a hidden window straight into the minimized state, so the
        // taskbar button comes back without the window covering the paste target.
        liveWindow()?.minimize();
      }
      deps.restoreCameraBubble();
    },
    reveal: () => deps.bringAppToFront(),
  };
}
