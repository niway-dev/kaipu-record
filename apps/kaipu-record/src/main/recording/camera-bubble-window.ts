import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { BUBBLE_MARGIN, BUBBLE_SIZE, bubbleBoundsInArea, type Rect } from "./area-geometry";

// The window is a bit bigger than the circle so its drop-shadow isn't clipped.
const SCREEN_MARGIN = BUBBLE_MARGIN;

/**
 * The floating webcam bubble. A frameless, transparent, always-on-top window
 * showing the live camera in a circle. The user drags it where they want; because
 * it sits on screen, the screen recording captures it — no compositing needed.
 *
 * Unlike the control bar, this window is deliberately NOT content-protected, so it
 * *does* appear in the recording.
 *
 * On macOS it is a `panel` and joins full-screen Spaces with
 * `skipTransformProcessType`: the bubble is destroyed and recreated on every
 * camera toggle, and each creation used to hide the Dock icon (and Cmd+Tab)
 * through Electron's default process transform. See ADR 0029.
 */
export class CameraBubbleWindow {
  private window: BrowserWindow | null = null;
  /** The recorded area (global DIP) while an area records; null otherwise. */
  private anchor: Rect | null = null;

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.fits()) this.window.showInactive();
      return;
    }
    this.window = new BrowserWindow({
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
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
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/?window=camera-bubble`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/index.html"), {
        search: "?window=camera-bubble",
      });
    }

    this.window.once("ready-to-show", () => {
      this.position();
      if (this.fits()) this.window?.showInactive();
    });
    this.window.on("closed", () => {
      this.window = null;
    });
  }

  /**
   * Keep the bubble inside a recorded area (ADR 0030): the bubble is recorded as part of the
   * screen, so outside the area it would vanish from the video without a word. An area too
   * small for it hides it until the anchor is cleared; `null` returns it to its usual corner
   * (the caller shows it again if the camera is still on).
   */
  anchorTo(area: Rect | null): void {
    this.anchor = area;
    if (!this.window || this.window.isDestroyed()) return;
    this.position();
    if (!this.fits()) this.window.hide();
  }

  /** Bring the bubble above other always-on-top windows (Windows orders them by show time). */
  raise(): void {
    if (this.window && !this.window.isDestroyed()) this.window.moveTop();
  }

  /** True while the bubble has an active (non-destroyed) window and is visible. */
  isVisible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  /**
   * Temporarily hide the bubble without releasing the camera device — used
   * while a screenshot region-select is on screen (the bubble sits above
   * everything, so it would otherwise land in the shot). Call `show()` to
   * bring it back; the device stays held the whole time, unlike `destroy()`.
   */
  hide(): void {
    this.window?.hide();
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

  private fits(): boolean {
    return this.anchor === null || bubbleBoundsInArea(this.anchor) !== null;
  }

  /**
   * Inside the recorded area when there is one; otherwise the bottom-left corner of the
   * active display (clear of the bar).
   */
  private position(): void {
    if (!this.window) return;
    if (this.anchor) {
      const inside = bubbleBoundsInArea(this.anchor);
      if (inside) this.window.setBounds(inside);
      return;
    }
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
