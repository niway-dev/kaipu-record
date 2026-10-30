import { BrowserWindow, screen } from "electron";
import { release } from "node:os";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { DEFAULT_CAMERA_BUBBLE, clampCameraBubbleSize } from "@shared/camera-bubble";
import {
  BUBBLE_PAD,
  bubbleBoundsAt,
  bubbleBoundsInArea,
  bubbleSizeOf,
  type BubbleCorner,
  fullDisplayBorderAllowed,
  type Rect,
} from "./area-geometry";

/**
 * The floating webcam bubble. A frameless, transparent, always-on-top window
 * showing the live camera in a circle or a rounded square, for the user to see themselves.
 *
 * It starts at the bottom-left corner of the recorded area (or of the display) and the user
 * moves it by pressing on it and dragging. The drag is driven from the renderer's pointer
 * events (`beginMove` / `moveBy`), not by an OS drag region: main clamps every step inside
 * the recorded area, and the bubble keeps receiving the clicks its hover controls need. A
 * size change, from the settings UI or the resize grip, keeps the window's bottom-left
 * corner where it is, so the bubble grows up and to the right. The OS can neither move nor
 * resize the window itself. The position lives in memory only: per app session on the
 * display, and per take inside an area (each area recording starts at the area's corner,
 * where the overlay's placeholder showed it).
 *
 * It is content-protected from creation, so the screen recording never carries it: the face
 * is recorded in the take's own webcam file and composed on export, where the editor can move,
 * hide or restyle it (ADR 0032). The protection is set right after the window exists, before
 * any capture stream could see it. Windows before 10 2004 cannot exclude a window from
 * capture (it comes out black), so there the bubble stays unprotected and the take records
 * no webcam file: the bubble appears in the screen recording, as it did before the track.
 *
 * On macOS it is a `panel` and joins full-screen Spaces with
 * `skipTransformProcessType`: the bubble is destroyed and recreated on every
 * camera toggle, and each creation used to hide the Dock icon (and Cmd+Tab)
 * through Electron's default process transform. See ADR 0029.
 */
export class CameraBubbleWindow {
  private window: BrowserWindow | null = null;
  /** `dispose()` ran: the app is quitting, so no window is created again. */
  private disposed = false;
  /** The recorded area (global DIP) while an area records; null otherwise. */
  private anchor: Rect | null = null;
  /** The size the grip is dragging to, until the release persists it. */
  private previewSize: number | null = null;
  /** Where the user dropped the bubble outside an area recording (kept across toggles). */
  private placedOnDisplay: BubbleCorner | null = null;
  /** Where the user dropped the bubble inside the current area (reset per area). */
  private placedInArea: BubbleCorner | null = null;
  /** The window's corner when the current move began; `moveBy` offsets from it. */
  private moveStart: BubbleCorner | null = null;

  /** `size` reads the persisted bubble size; injected so this class never reads disk. */
  constructor(
    private readonly size: () => number = () => DEFAULT_CAMERA_BUBBLE.size,
    /** Whether capture can exclude a window on this OS; injected for tests. */
    private readonly excludable: () => boolean = () =>
      fullDisplayBorderAllowed(process.platform, release()),
  ) {}

  show(): void {
    if (this.disposed) return;
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
      // Moved only through `moveBy`, which keeps it inside the recorded area: no drag region
      // in the renderer, and nothing the OS could move or resize on its own.
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
    if (this.excludable()) this.window.setContentProtection(true);
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
   * Keep the bubble inside a recorded area (ADR 0030): the bubble stays where the
   * user sees it relative to what is recorded, and the face of the take is composed on export
   * from the webcam file, not captured from this window (so the anchor no longer decides
   * whether the face is recorded, only where it is seeded). An area too small for it hides it
   * until the anchor is cleared; `null` returns it to its usual corner
   * (the caller shows it again if the camera is still on).
   */
  anchorTo(area: Rect | null): void {
    this.anchor = area;
    this.placedInArea = null;
    this.moveStart = null;
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

  /** A press on the bubble: remember where the window is, for the `moveBy` calls after it. */
  beginMove(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const { x, y, height } = this.window.getBounds();
    this.moveStart = { x, bottom: y + height };
  }

  /**
   * Move the bubble by the pointer's offset (DIP) since `beginMove`, kept inside the recorded
   * area (or the work area of the display it is dragged onto).
   */
  moveBy(dx: number, dy: number): void {
    const start = this.moveStart;
    if (!start || !this.window || this.window.isDestroyed()) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.place({ x: start.x + dx, bottom: start.bottom + dy });
    const bounds = this.bounds();
    if (!bounds) return;
    // Remember where it actually landed, so a later resize grows from the clamped corner.
    this.place({ x: bounds.x, bottom: bounds.y + bounds.height });
    this.window.setBounds(bounds);
  }

  /**
   * Bring the bubble above other always-on-top windows (Windows orders them by show time).
   * Only a visible one: on macOS `moveTop()` orders a hidden window back on screen.
   */
  raise(): void {
    if (this.isVisible()) this.window?.moveTop();
  }

  /**
   * The window's bounds (global DIP) while the bubble is on screen, else null: what the
   * recording captured, for the take's recorded bubble position.
   */
  visibleBounds(): Rect | null {
    return this.isVisible() ? (this.window?.getBounds() ?? null) : null;
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
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /** Quit: `destroy()`, and no window is created again. */
  dispose(): void {
    this.disposed = true;
    this.destroy();
  }

  private fits(): boolean {
    return this.anchor === null || bubbleBoundsInArea(this.anchor, this.currentSize()) !== null;
  }

  private currentSize(): number {
    return this.previewSize ?? this.size();
  }

  private placed(): BubbleCorner | null {
    return this.anchor ? this.placedInArea : this.placedOnDisplay;
  }

  private place(corner: BubbleCorner): void {
    if (this.anchor) this.placedInArea = corner;
    else this.placedOnDisplay = corner;
  }

  /**
   * Inside the recorded area when there is one; otherwise the work area of the display the
   * bubble was dropped on (or the active one, clear of the bar). At the container's
   * bottom-left corner until the user moves it. `null` only when an area cannot hold even
   * the smallest bubble.
   */
  private bounds(): Rect | null {
    const placed = this.placed();
    const container =
      this.anchor ??
      screen.getDisplayNearestPoint(
        placed ? { x: placed.x, y: placed.bottom } : screen.getCursorScreenPoint(),
      ).workArea;
    const corner = bubbleBoundsInArea(container, this.currentSize());
    if (!corner || !placed) return corner;
    return bubbleBoundsAt(container, corner.width, placed);
  }

  private position(): void {
    if (!this.window) return;
    const bounds = this.bounds();
    if (bounds) this.window.setBounds(bounds);
  }
}
