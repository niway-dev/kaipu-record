import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types";
import { CONTROL_BAR_STARTING_TICK, type RecordingTick } from "@shared/types/ipc";
import type { Rect } from "./area-geometry";
import { controlBarBounds } from "./control-bar-placement";

// 480 since the bar carries the recording's mode chip ("16:9", "SCREEN"); 528 since it also
// carries "Turn camera off" while the camera is on (a 36 px button and its 12 px gap).
const BAR_WIDTH = 528;
const BAR_HEIGHT = 82;

/**
 * The floating, always-on-top control bar. A frameless, transparent window that
 * renders the renderer in control-bar mode (`?window=control-bar`). It floats
 * over every other app — including fullscreen — so the user keeps control while
 * working in the app they're recording.
 *
 * On macOS it is a `panel` and joins full-screen Spaces with
 * `skipTransformProcessType`, like every other floating window here. Without
 * that flag Electron hides the Dock icon to get a plain window over a
 * full-screen app, which also removes Kaipu from Cmd+Tab — and the activation
 * policy setter, which only applies real transitions, had no reason to put it
 * back. See ADR 0029 and backlog/bug-app-lost-from-app-switcher.
 */
export interface ControlBarOptions {
  /** Include the bar in the screen recording (default false → content-protected). */
  includeInRecording?: boolean;
  /**
   * The recorded rectangle in global DIP (an area), so the bar sits outside it; `null` or
   * absent for a whole display (bottom centre, as before). See `controlBarBounds`.
   */
  anchor?: Rect | null;
}

export class ControlBarWindow {
  private window: BrowserWindow | null = null;
  /** The display being recorded, so the bar appears there (multi-monitor). */
  private displayId: string | undefined;
  /** Whether the bar is left capturable (mirrors `AppSettings.showBarInRecording`). */
  private includeInRecording = false;
  /** The recorded area to keep clear of, when only part of the display is recorded. */
  private anchor: Rect | null = null;
  /**
   * Whether the bar should be on screen. A new window shows itself only once it has painted
   * (`ready-to-show`), which can come after a fast failed start or an early Stop hid it: it
   * must then stay hidden, or it floats over an idle app with a Stop that does nothing.
   */
  private wanted = false;
  /** The current window has painted once; before that, showing it would show nothing. */
  private ready = false;
  /** What the bar shows now, replayed to a window whose page was still loading. */
  private lastTick: RecordingTick = CONTROL_BAR_STARTING_TICK;

  show(displayId?: string, options?: ControlBarOptions): void {
    this.displayId = displayId;
    this.anchor = options?.anchor ?? null;
    if (options?.includeInRecording !== undefined) {
      this.includeInRecording = options.includeInRecording;
    }
    this.wanted = true;
    if (this.window && !this.window.isDestroyed()) {
      this.applyContentProtection();
      this.position();
      // Still loading: its `ready-to-show` shows it.
      if (this.ready) this.window.showInactive();
      return;
    }
    this.ready = false;
    const window = new BrowserWindow({
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      show: false,
      frame: false,
      transparent: true,
      // Fully transparent backdrop — without this a transparent window can paint
      // an opaque/dark backing that shows as an ugly box over light backgrounds.
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
    this.window = window;
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    this.applyContentProtection();

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void this.window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/?window=control-bar`);
    } else {
      void this.window.loadFile(join(__dirname, "../renderer/index.html"), {
        search: "?window=control-bar",
      });
    }

    this.window.once("ready-to-show", () => {
      if (this.window !== window || window.isDestroyed()) return;
      this.ready = true;
      // A tick sent while the page loaded found no listener: apply the latest one now.
      window.webContents.send(IPC_CHANNELS.controlTick, this.lastTick);
      if (!this.wanted) return;
      this.position();
      window.showInactive();
    });
    this.window.on("closed", () => {
      if (this.window !== window) return;
      this.window = null;
      this.ready = false;
    });
  }

  /**
   * Bring the bar above other always-on-top windows (Windows orders them by show time). Only
   * while it is wanted: on macOS `moveTop()` orders a hidden window back on screen, and the
   * countdown raises the floating windows before the take, so the bar kept hidden from the
   * last take came back as "Starting…" and outlived a cancelled countdown.
   */
  raise(): void {
    if (!this.wanted) return;
    if (this.window && !this.window.isDestroyed()) this.window.moveTop();
  }

  /**
   * Apply content protection from `includeInRecording`. On = keep the bar out of
   * the recording (macOS `NSWindowSharingNone`); off = leave it capturable. The
   * camera bubble, by contrast, is always capturable on purpose.
   */
  private applyContentProtection(): void {
    this.window?.setContentProtection(!this.includeInRecording);
  }

  /** Show the recorder's tick (timer, level, status) on the bar. */
  sendTick(tick: RecordingTick): void {
    this.lastTick = tick;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.controlTick, tick);
    }
  }

  /** Put the bar in its neutral "starting" state: a new take, nothing ticked yet. */
  reset(): void {
    this.sendTick(CONTROL_BAR_STARTING_TICK);
  }

  /**
   * Hide the bar, kept for the next take, and reset it while it is off screen: a window
   * shown again repaints on its next frame, so the last take's "Saving…" must already be gone.
   */
  hide(): void {
    this.wanted = false;
    this.window?.hide();
    this.reset();
  }

  destroy(): void {
    this.wanted = false;
    this.window?.destroy();
    this.window = null;
    this.ready = false;
  }

  private position(): void {
    if (!this.window) return;
    // Prefer the recorded display; fall back to the one under the cursor.
    const recorded =
      this.displayId !== undefined
        ? screen.getAllDisplays().find((d) => String(d.id) === this.displayId)
        : undefined;
    const display = recorded ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window.setBounds(
      controlBarBounds(display.workArea, { width: BAR_WIDTH, height: BAR_HEIGHT }, this.anchor),
    );
  }
}
