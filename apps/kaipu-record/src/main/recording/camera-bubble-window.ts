import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

// Window is a bit bigger than the circle so its drop-shadow isn't clipped.
const BUBBLE_SIZE = 224;
const SCREEN_MARGIN = 40;

/**
 * The floating webcam bubble. A frameless, transparent, always-on-top window
 * showing the live camera in a circle. The user drags it where they want; because
 * it sits on screen, the screen recording captures it — no compositing needed.
 *
 * Unlike the control bar, this window is deliberately NOT content-protected, so it
 * *does* appear in the recording.
 */
export class CameraBubbleWindow {
  private window: BrowserWindow | null = null;

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      return;
    }
    this.window = new BrowserWindow({
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/?window=camera-bubble`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/index.html"), {
        search: "?window=camera-bubble",
      });
    }

    this.window.once("ready-to-show", () => {
      this.position();
      this.window?.showInactive();
    });
    this.window.on("closed", () => {
      this.window = null;
    });
  }

  /**
   * Destroy the bubble window. Unlike the control bar we never just `hide()` it:
   * the renderer holds the camera via getUserMedia, so the window must be torn
   * down to release the device (and turn the macOS green in-use light off).
   */
  destroy(): void {
    this.window?.destroy();
    this.window = null;
  }

  /** Default to the bottom-left corner of the active display (clear of the bar). */
  private position(): void {
    if (!this.window) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, height } = display.workArea;
    this.window.setBounds({
      x: x + SCREEN_MARGIN,
      y: y + height - BUBBLE_SIZE - SCREEN_MARGIN,
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
    });
  }
}
