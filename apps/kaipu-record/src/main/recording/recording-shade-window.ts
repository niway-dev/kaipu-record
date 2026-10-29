import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types";
import type { RecordingShadeState, RecordingShadeView } from "@shared/types/ipc";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import { markRecordTiming } from "./record-timing";

/** The slice of `Electron.Display` the shade reads. */
export interface ShadeDisplay {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * The marker over the recorded display (spec "Record capture modes" decision 4, extended by
 * its task 5 notes; no ADR amendment). While the countdown runs it dims everything outside
 * the chosen region and shows the number. While an area records it keeps the dark fill
 * outside the area and adds a pink border just outside it and a "REC · border not recorded"
 * tag; a whole-display recording gets only a pink border around the display, no fill (and
 * none at all where content protection cannot exclude it, see `fullDisplayBorderAllowed`).
 *
 * Three properties carry the whole design and are pinned by `floating-window-policy.test.ts`:
 * - content-protected, so the shade itself is never in the video;
 * - click-through (`setIgnoreMouseEvents(true)`) and not focusable, so the app being
 *   recorded keeps every click, scroll and key;
 * - a macOS `panel` joining full-screen Spaces with `skipTransformProcessType` (ADR 0029).
 *
 * It sits one level below the control bar and the camera bubble ("status" against their
 * "screen-saver"), so neither is ever covered; `onShown` lets the hub raise them as well,
 * because Windows ignores the levels and orders topmost windows by when they were shown.
 *
 * The window is loaded once, hidden and neutral (`prewarm`), and reused by every take: a
 * `show` only moves it onto its display and sends it the region and phase as state, so the
 * countdown does not wait for a renderer to load. `hide` keeps it and resets it to neutral
 * while it is off screen, so a reused window never repaints the previous take.
 */
export class RecordingShadeWindow {
  private window: BrowserWindow | null = null;
  /** What the current window covers, so a countdown shade can become the recording one. */
  private key: string | null = null;
  private rect: CaptureRect | null = null;
  private state: RecordingShadeState = { phase: "idle" };
  /** The page has painted once; before that, showing the window would show nothing. */
  private ready = false;
  /** Whether the shade should be on screen. A show that finds the page loading waits for it. */
  private wanted = false;
  /** The window is on screen (shown and not hidden since). */
  private visible = false;
  /** The callback of the `show` that is waiting for the page to load. */
  private pendingShown: (() => void) | undefined;
  /** `destroy()` ran: the app is quitting, so no window is created again. */
  private disposed = false;

  /**
   * Load the window hidden and neutral, so the first `show` of a take only sends it a state
   * (the way the control bar's window is kept). Call once the app is up; no-op when one exists.
   */
  prewarm(): void {
    if (this.disposed) return;
    this.ensureWindow(screen.getPrimaryDisplay().bounds);
  }

  /** Quit: drop the window for good (no `beforeunload` round trip) and never create another. */
  destroy(): void {
    this.disposed = true;
    this.hide();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /**
   * Cover `display`, marking `rect` (display-relative DIP) or, with `null`, the whole
   * display. A shade already up for the same region only changes phase; any other region
   * repaints the same window, moved onto its display.
   */
  show(
    display: ShadeDisplay,
    rect: CaptureRect | null,
    onShown?: () => void,
    state: RecordingShadeState = { phase: "recording" },
  ): void {
    // Quitting: nothing to cover, and a caller waiting on `onShown` must not wait forever.
    if (this.disposed) {
      onShown?.();
      return;
    }
    const key = JSON.stringify([display.id, display.bounds, rect]);
    if (this.window && !this.window.isDestroyed() && this.visible && this.key === key) {
      this.update(state);
      onShown?.();
      return;
    }
    const reused = this.window !== null && !this.window.isDestroyed() && this.ready;
    const window = this.ensureWindow(display.bounds);
    window.setBounds(display.bounds);
    this.key = key;
    this.rect = rect;
    this.state = state;
    this.wanted = true;
    this.pendingShown = onShown;
    if (!this.ready) {
      markRecordTiming("countdown shade loaded fresh");
      return; // `ready-to-show` shows it with the latest state
    }
    if (reused) markRecordTiming("countdown shade reused");
    this.present(window);
  }

  /** Change what the shade paints (the next countdown tick, or recording). */
  update(state: RecordingShadeState): void {
    this.state = state;
    if (this.window && !this.window.isDestroyed() && this.ready) this.send(this.window);
  }

  /**
   * Take the shade off screen, kept for the next take and reset to neutral while hidden: a
   * window shown again repaints on its next frame, so the last take's region and number must
   * already be gone.
   */
  hide(): void {
    this.wanted = false;
    this.visible = false;
    this.pendingShown = undefined;
    this.key = null;
    this.rect = null;
    this.state = { phase: "idle" };
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.hide();
    if (this.ready) this.send(window);
  }

  private send(window: BrowserWindow): void {
    const view: RecordingShadeView = { ...this.state, rect: this.rect };
    window.webContents.send(IPC_CHANNELS.recordingShadeState, view);
  }

  /** Paint the current region and state, then put the window on screen. */
  private present(window: BrowserWindow): void {
    // State first: the window is never on screen with the previous take's paint.
    this.send(window);
    window.showInactive();
    this.visible = true;
    const onShown = this.pendingShown;
    this.pendingShown = undefined;
    onShown?.();
  }

  private ensureWindow(bounds: ShadeDisplay["bounds"]): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.ready = false;
    this.visible = false;
    const { x, y, width, height } = bounds;
    const window = new BrowserWindow({
      x,
      y,
      width,
      height,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        // Hidden between takes: a throttled page would answer the first state late.
        backgroundThrottling: false,
      },
    });
    this.window = window;
    window.setIgnoreMouseEvents(true);
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, "status");
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });

    const search = "?window=recording-shade";
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${search}`);
    } else {
      void window.loadFile(join(__dirname, "../renderer/index.html"), { search });
    }
    window.once("ready-to-show", () => {
      if (this.window !== window || window.isDestroyed()) return;
      this.ready = true;
      // A show or phase change that arrived while the page loaded is applied now.
      if (this.wanted) this.present(window);
    });
    window.on("closed", () => {
      if (this.window !== window) return;
      this.window = null;
      this.ready = false;
      this.visible = false;
      this.key = null;
    });
    return window;
  }
}
