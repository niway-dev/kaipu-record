import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { DEFAULT_CAMERA_BUBBLE, clampCameraBubbleSize } from "@shared/camera-bubble";
import { BUBBLE_PAD, bubbleBoundsInArea, bubbleSizeOf, type Rect } from "./area-geometry";

/**
 * The floating webcam bubble. A frameless, transparent, always-on-top window
 * showing the live camera in a circle or a rounded square. Because it sits on screen,
 * the screen recording captures it — no compositing needed.
 *
 * It is fixed at the bottom-left corner of the recorded area (or of the display) and is
 * not draggable: only its shape and size are settings. A size change, from the settings
 * UI or the bubble's own resize grip, resizes the window from that anchored corner, so
 * the bubble grows up and to the right. The window itself is not OS-resizable; the grip
 * (in the renderer) is the only handle.
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
  /** The size the grip is dragging to, until the release persists it. */
  private previewSize: number | null = null;

  /** `size` reads the persisted bubble size; injected so this class never reads disk. */
  constructor(private readonly size: () => number = () => DEFAULT_CAMERA_BUBBLE.size) {}

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.fits()) this.window.showInactive();
      return;
    }
    this.window = new BrowserWindow({
      width: DEFAULT_CAMERA_BUBBLE.size + 2 * BUBBLE_PAD,
      height: DEFAULT_CAMERA_BUBBLE.size + 2 * BUBBLE_PAD,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      // Fixed at its corner (spec record-capture-modes, decision 6): no drag region in the
      // renderer, and nothing the OS could move or resize either.
      movable: false,
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

  /**
   * Re-read the persisted size and re-place the bubble (a settings change). Clears a grip
   * preview: the release that ended it is what persisted the size being applied now.
   */
  applySize(): void {
    this.previewSize = null;
    if (!this.window || this.window.isDestroyed()) return;
    this.position();
  }

  /**
   * Resize to `size` while the grip is dragged, without persisting. Returns the size
   * actually applied once the range and the area (or display) clamp it.
   */
  preview(size: number): number {
    this.previewSize = clampCameraBubbleSize(size);
    if (!this.window || this.window.isDestroyed()) return this.previewSize;
    const bounds = this.bounds();
    if (bounds) this.window.setBounds(bounds);
    return bounds ? bubbleSizeOf(bounds) : this.previewSize;
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
    return this.anchor === null || bubbleBoundsInArea(this.anchor, this.currentSize()) !== null;
  }

  private currentSize(): number {
    return this.previewSize ?? this.size();
  }

  /**
   * Inside the recorded area when there is one; otherwise the bottom-left corner of the
   * active display's work area (clear of the bar). `null` only when an area cannot hold
   * even the smallest bubble.
   */
  private bounds(): Rect | null {
    if (this.anchor) return bubbleBoundsInArea(this.anchor, this.currentSize());
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return bubbleBoundsInArea(display.workArea, this.currentSize());
  }

  private position(): void {
    if (!this.window) return;
    const bounds = this.bounds();
    if (bounds) this.window.setBounds(bounds);
  }
}
