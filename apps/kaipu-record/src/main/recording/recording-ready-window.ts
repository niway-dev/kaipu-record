import { BrowserWindow, ipcMain, screen } from "electron";
import type { BrowserWindowConstructorOptions, Rectangle } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  handOffFor,
  parseRecordingReadyAction,
  parseRecordingReadyPayload,
  type RecordingReadyAction,
  type RecordingReadyHandOff,
  type RecordingReadyPayload,
} from "@shared/types/recording-ready";

/** The card's width (`StatusCard` wide), in DIP. */
export const READY_CARD_WIDTH = 420;
/** Transparent room around the card, so its shadow is not clipped by the window. */
export const READY_WINDOW_PADDING = 16;
export const READY_WINDOW_WIDTH = READY_CARD_WIDTH + 2 * READY_WINDOW_PADDING;
/** Until the card reports its height: about its size with every row. */
export const READY_DEFAULT_CARD_HEIGHT = 290;
/** Gap between the card (not the window) and the work area's top and right edges. */
export const READY_CARD_MARGIN = 18;

/** The slice of `BrowserWindow` the card uses, so tests can pass a fake. */
export interface ReadyWindow {
  readonly webContents: { send(channel: string, payload: unknown): void };
  setAlwaysOnTop(flag: boolean, level: "floating"): void;
  setContentProtection(enable: boolean): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean },
  ): void;
  setBounds(bounds: Rectangle): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
  on(event: "closed", listener: () => void): void;
}

type Display = { id: number; workArea: Rectangle };
type IpcListener = (event: { sender: unknown }, payload?: unknown) => void;

export interface RecordingReadyDeps {
  createWindow(options: BrowserWindowConstructorOptions): ReadyWindow;
  /** Load `?window=recording-ready` into the window. */
  load(window: ReadyWindow): void;
  ipc: {
    on(channel: string, listener: IpcListener): void;
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown): void;
  };
  screen: {
    getAllDisplays(): Display[];
    /** The display under the pointer: where the user is, when the take's display is unknown. */
    getCursorDisplay(): Display;
  };
  platform: NodeJS.Platform;
  /** The display the last take recorded (the hub's), or null when unknown. */
  recordingDisplayId(): number | null;
  /** Show and focus the main window, then let its renderer navigate to `handOff`. */
  openInMain(handOff: RecordingReadyHandOff): void;
}

/**
 * The window's bounds: top-right of `workArea`, the card `READY_CARD_MARGIN` in from both
 * edges, as tall as the card plus its padding but never taller than the work area. Clamped
 * to the work area's left edge, so a display narrower than the window still shows its left.
 */
export function readyWindowBounds(workArea: Rectangle, cardHeight: number): Rectangle {
  const inset = READY_CARD_MARGIN - READY_WINDOW_PADDING;
  const right = workArea.x + workArea.width - READY_WINDOW_WIDTH - inset;
  const height = Math.min(Math.ceil(cardHeight) + 2 * READY_WINDOW_PADDING, workArea.height);
  return {
    x: Math.round(Math.max(workArea.x, right)),
    y: Math.round(workArea.y + inset),
    width: READY_WINDOW_WIDTH,
    height,
  };
}

/**
 * "Your video is ready" floating on the desktop (the capture toast's pattern): one frameless,
 * transparent, always-on-top panel at the top-right of the display the take recorded. It is
 * on screen whatever the main window is doing — hidden, minimized or behind another app —
 * and never brings the app forward: `showInactive`, and on macOS a non-activating panel.
 *
 * Unlike the toast it is focusable, so once the user clicks into it Escape closes it; it
 * still never takes focus by itself. It has no timer (the question is the point): it stays
 * until an action, ✕ or Escape, and the next recording re-targets the same window.
 * Content protection keeps it out of the next recording and of screenshots.
 */
export class RecordingReadyWindow {
  private window: ReadyWindow | null = null;
  /** The card renderer subscribed to `recording-ready:payload`; sends before that are lost. */
  private rendererReady = false;
  private payload: RecordingReadyPayload | null = null;
  private workArea: Rectangle | null = null;
  private cardHeight = READY_DEFAULT_CARD_HEIGHT;
  /** `destroy()` ran: the app is quitting, so no window is created again. */
  private disposed = false;

  constructor(private readonly deps: RecordingReadyDeps) {
    deps.ipc.handle(IPC_CHANNELS.recordingReadyShow, (_event, payload) => {
      const parsed = parseRecordingReadyPayload(payload);
      return parsed ? this.show(parsed) : false;
    });
    deps.ipc.on(IPC_CHANNELS.recordingReadyCardReady, (event) => {
      if (!this.isOwnSender(event.sender)) return;
      this.rendererReady = true;
      this.present();
    });
    deps.ipc.on(IPC_CHANNELS.recordingReadyResize, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const height = (payload as { height?: unknown } | undefined)?.height;
      if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return;
      this.cardHeight = height;
      if (this.payload && this.workArea && this.window && !this.window.isDestroyed()) {
        this.window.setBounds(readyWindowBounds(this.workArea, this.cardHeight));
      }
    });
    deps.ipc.on(IPC_CHANNELS.recordingReadyAction, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const action = parseRecordingReadyAction(payload);
      if (action) this.act(action);
    });
  }

  /**
   * Show `payload` on the recorded display, replacing whatever card is up. True when the
   * window exists (it paints once its renderer reports ready); false when it could not be
   * created, so the main window shows its in-app card instead.
   */
  show(payload: RecordingReadyPayload): boolean {
    if (this.disposed) return false;
    try {
      this.ensureWindow();
    } catch (error) {
      console.error("[recording-ready] could not create the floating window", error);
      this.window = null;
      return false;
    }
    this.payload = payload;
    this.workArea = this.displayWorkArea();
    this.present();
    return true;
  }

  /** Hide the card (✕, Escape, or before an action hands off to the main window). */
  close(): void {
    this.payload = null;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
    this.setSpaceBehavior(false);
  }

  /** Quit: close, drop the window for good, never show again. */
  destroy(): void {
    this.disposed = true;
    this.close();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  /** Every action closes the card first; all but ✕ then open the main window somewhere. */
  private act(action: RecordingReadyAction): void {
    const payload = this.payload;
    if (!payload) return;
    this.close();
    const handOff = handOffFor(action, payload);
    if (handOff) this.deps.openInMain(handOff);
  }

  private ensureWindow(): void {
    if (this.window && !this.window.isDestroyed()) return;
    this.rendererReady = false;
    const window = this.deps.createWindow({
      width: READY_WINDOW_WIDTH,
      height: READY_DEFAULT_CARD_HEIGHT + 2 * READY_WINDOW_PADDING,
      // macOS: a non-activating panel floats over full-screen apps and takes key without
      // activating the app (hub page desktop/floating-windows-over-full-screen).
      ...(this.deps.platform === "darwin" ? { type: "panel" } : {}),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      // Focusable so Escape reaches the card once the user clicks it; shown inactive, so it
      // never takes focus by itself.
      focusable: true,
      // The first click on a window of an inactive app lands on the button.
      acceptFirstMouse: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
      },
    });
    window.setAlwaysOnTop(true, "floating");
    // Out of `desktopCapturer` and `screencapture`: a card still up never lands in the next
    // recording or screenshot.
    window.setContentProtection(true);
    window.on("closed", () => {
      if (this.window !== window) return;
      this.window = null;
      this.rendererReady = false;
    });
    this.window = window;
    this.deps.load(window);
  }

  /** Paint and show the current payload, once the renderer can receive it. */
  private present(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || !this.rendererReady || !this.payload) return;
    if (this.workArea) window.setBounds(readyWindowBounds(this.workArea, this.cardHeight));
    window.webContents.send(IPC_CHANNELS.recordingReadyPayload, this.payload);
    this.setSpaceBehavior(true);
    window.showInactive();
  }

  /** Join every Space, full-screen ones included, while shown; leave them when hidden. */
  private setSpaceBehavior(open: boolean): void {
    if (this.deps.platform !== "darwin" || !this.window || this.window.isDestroyed()) return;
    this.window.setVisibleOnAllWorkspaces(open, {
      visibleOnFullScreen: open,
      skipTransformProcessType: true,
    });
  }

  private displayWorkArea(): Rectangle {
    const id = this.deps.recordingDisplayId();
    const recorded =
      id === null
        ? undefined
        : this.deps.screen.getAllDisplays().find((display) => display.id === id);
    return (recorded ?? this.deps.screen.getCursorDisplay()).workArea;
  }

  private isOwnSender(sender: unknown): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && sender === this.window.webContents);
  }
}

/** The production window: real `BrowserWindow`, `screen` and `ipcMain`. */
export function createRecordingReadyWindow(
  app: Pick<RecordingReadyDeps, "recordingDisplayId" | "openInMain">,
): RecordingReadyWindow {
  return new RecordingReadyWindow({
    ...app,
    createWindow: (options) => new BrowserWindow(options),
    load: (window) => {
      const browserWindow = window as BrowserWindow;
      if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        void browserWindow.loadURL(
          `${process.env["ELECTRON_RENDERER_URL"]}/?window=recording-ready`,
        );
      } else {
        void browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
          search: "?window=recording-ready",
        });
      }
    },
    ipc: ipcMain,
    screen: {
      getAllDisplays: () => screen.getAllDisplays(),
      getCursorDisplay: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
    },
    platform: process.platform,
  });
}
