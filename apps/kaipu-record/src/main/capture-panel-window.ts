import { BrowserWindow, ipcMain, screen } from "electron";
import type { Rectangle } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

const PANEL_WIDTH = 340;
const PANEL_MIN_HEIGHT = 180;
const PANEL_MAX_HEIGHT = 640;
const PANEL_INITIAL_HEIGHT = 380;

/**
 * Frameless, always-on-top panel shown from the menu-bar tray. It loads the same
 * renderer with `?mode=capture`, so React renders <CapturePanel/> instead of the
 * main app. Auto-hides on blur and repositions under the tray icon on each show.
 *
 * It is created ahead of the first click (`prewarm`) and only revealed once it
 * has painted. Created on the click instead, the first open showed an empty
 * transparent window while the renderer loaded and React mounted.
 */
export class CapturePanelWindow {
  private window: BrowserWindow | null = null;
  /** True once the renderer has painted; showing before that shows nothing. */
  private painted = false;
  /** A click that arrived before the first paint — honoured when it lands. */
  private pendingTrayBounds: Rectangle | null = null;

  constructor() {
    this.registerIpc();
  }

  toggle(trayBounds: Rectangle): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.hide();
    } else {
      this.show(trayBounds);
    }
  }

  /** Create the window hidden so the first tray click finds it already loaded. */
  prewarm(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    }
  }

  show(trayBounds: Rectangle): void {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    }
    if (!this.painted) {
      this.pendingTrayBounds = trayBounds;
      return;
    }
    this.position(trayBounds);
    this.window?.show();
    this.window?.focus();
  }

  hide(): void {
    this.pendingTrayBounds = null;
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /** Anchor the panel below (or above) the tray icon, clamped to the work area. */
  private position(trayBounds: Rectangle): void {
    if (!this.window) return;
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    const { workArea } = display;
    const [width, height] = this.window.getSize();

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
    const trayAtTop = trayBounds.y < workArea.y + workArea.height / 2;
    let y = trayAtTop ? trayBounds.y + trayBounds.height + 4 : trayBounds.y - height - 4;

    x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - width - 8));
    y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - height - 8));

    this.window.setPosition(x, y);
  }

  private create(): void {
    this.window = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_INITIAL_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
      },
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/?mode=capture`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/index.html"), {
        search: "?mode=capture",
      });
    }

    this.painted = false;
    this.window.once("ready-to-show", () => {
      this.painted = true;
      const pending = this.pendingTrayBounds;
      this.pendingTrayBounds = null;
      if (pending) this.show(pending);
    });

    // Clicking anywhere else dismisses the panel (natural popover behavior).
    this.window.on("blur", () => this.hide());
    this.window.on("closed", () => {
      this.window = null;
      this.painted = false;
      this.pendingTrayBounds = null;
    });
  }

  private registerIpc(): void {
    ipcMain.on("capture-panel:resize", (_event, height: number) => {
      if (this.window && !this.window.isDestroyed()) {
        const clamped = Math.max(PANEL_MIN_HEIGHT, Math.min(Math.round(height), PANEL_MAX_HEIGHT));
        this.window.setContentSize(PANEL_WIDTH, clamped);
      }
    });
  }
}
