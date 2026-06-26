import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

const BAR_WIDTH = 360;
const BAR_HEIGHT = 64;
const BOTTOM_MARGIN = 40;

/**
 * The floating, always-on-top control bar. A frameless, transparent window that
 * renders the renderer in control-bar mode (`?window=control-bar`). It floats
 * over every other app — including fullscreen — so the user keeps control while
 * working in the app they're recording.
 */
export class ControlBarWindow {
  private window: BrowserWindow | null = null;

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.position();
      this.window.showInactive();
      return;
    }
    this.window = new BrowserWindow({
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
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
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/?window=control-bar`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/index.html"), {
        search: "?window=control-bar",
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

  /** Push a message to the bar renderer. */
  send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  hide(): void {
    this.window?.hide();
  }

  destroy(): void {
    this.window?.destroy();
    this.window = null;
  }

  private position(): void {
    if (!this.window) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    this.window.setBounds({
      x: Math.round(x + (width - BAR_WIDTH) / 2),
      y: Math.round(y + height - BAR_HEIGHT - BOTTOM_MARGIN),
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
    });
  }
}
