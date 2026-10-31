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
/**
 * Transparent room around the card. The floating card's own shadow is sized to fit inside it
 * (`recording-ready-card.module.css`), so the window does not clip it.
 */
export const READY_WINDOW_PADDING = 16;
export const READY_WINDOW_WIDTH = READY_CARD_WIDTH + 2 * READY_WINDOW_PADDING;
/** Until the card reports its height: about its size with every row. */
export const READY_DEFAULT_CARD_HEIGHT = 290;
/** Gap between the card (not the window) and the work area's top and right edges. */
export const READY_CARD_MARGIN = 18;
/**
 * How long a new window's renderer has to report ready before `show()` gives up and the
 * main window shows its in-app card instead.
 */
export const READY_LOAD_TIMEOUT_MS = 3000;

/** The slice of `BrowserWindow` the card uses, so tests can pass a fake. */
export interface ReadyWindow {
  readonly webContents: {
    send(channel: string, payload: unknown): void;
    /** A load that failed, or a renderer that died: the card cannot paint. */
    on(event: "did-fail-load" | "render-process-gone", listener: () => void): void;
  };
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
  /** Load `?window=recording-ready` into the window; a rejection counts as a failed load. */
  load(window: ReadyWindow): Promise<unknown> | void;
  /** Whether an IPC sender is the main window's renderer, the only one that may ask. */
  isMainSender(sender: unknown): boolean;
  ipc: {
    on(channel: string, listener: IpcListener): void;
    handle(
      channel: string,
      listener: (event: { sender: unknown }, payload?: unknown) => unknown,
    ): void;
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
  /** The `show()` waiting for a new window's renderer: settled by card-ready or a failure. */
  private pending: { resolve(shown: boolean): void; timer: ReturnType<typeof setTimeout> } | null =
    null;

  constructor(private readonly deps: RecordingReadyDeps) {
    deps.ipc.handle(IPC_CHANNELS.recordingReadyShow, (event, payload) => {
      // Only the main window asks: no other renderer (this card, the capture toast, the
      // overlays) may float a card for an arbitrary recording.
      if (!deps.isMainSender(event.sender)) return false;
      const parsed = parseRecordingReadyPayload(payload);
      return parsed ? this.show(parsed) : false;
    });
    deps.ipc.on(IPC_CHANNELS.recordingReadyCardReady, (event) => {
      if (!this.isOwnSender(event.sender)) return;
      this.rendererReady = true;
      this.present();
      this.settle(true);
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
   * Show `payload` on the recorded display, replacing whatever card is up. Resolves true once
   * the card is on screen; false when the window could not be created, its renderer failed to
   * load or died, or did not report ready within `READY_LOAD_TIMEOUT_MS` — the main window
   * then shows its in-app card instead, so the card is never lost.
   */
  show(payload: RecordingReadyPayload): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    try {
      this.ensureWindow();
    } catch (error) {
      console.error("[recording-ready] could not create the floating window", error);
      this.window = null;
      return Promise.resolve(false);
    }
    this.payload = payload;
    this.workArea = this.displayWorkArea();
    if (this.rendererReady) {
      this.present();
      return Promise.resolve(true);
    }
    // A newer card replaces an older one still waiting: the older one is not lost, it was
    // superseded, so its page must not show it in-app either.
    this.settle(true);
    return new Promise<boolean>((resolve) => {
      const window = this.window;
      const timer = setTimeout(() => {
        console.error("[recording-ready] the card's renderer never reported ready");
        if (window) this.fail(window);
      }, READY_LOAD_TIMEOUT_MS);
      this.pending = { resolve, timer };
    });
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
    this.settle(false);
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
      this.settle(false);
    });
    window.webContents.on("did-fail-load", () => this.fail(window));
    window.webContents.on("render-process-gone", () => this.fail(window));
    this.window = window;
    void Promise.resolve(this.deps.load(window)).catch(() => this.fail(window));
  }

  /**
   * The card cannot paint in `window`: drop the window, so the next `show()` creates a fresh
   * one rather than `showInactive()`-ing a blank one, and answer a waiting `show()` false.
   */
  private fail(window: ReadyWindow): void {
    if (this.window !== window) return;
    this.window = null;
    this.rendererReady = false;
    this.payload = null;
    if (!window.isDestroyed()) window.destroy();
    this.settle(false);
  }

  private settle(shown: boolean): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(shown);
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
  app: Pick<RecordingReadyDeps, "recordingDisplayId" | "openInMain" | "isMainSender">,
): RecordingReadyWindow {
  return new RecordingReadyWindow({
    ...app,
    createWindow: (options) => new BrowserWindow(options),
    load: (window) => {
      const browserWindow = window as BrowserWindow;
      if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        return browserWindow.loadURL(
          `${process.env["ELECTRON_RENDERER_URL"]}/?window=recording-ready`,
        );
      }
      return browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
        search: "?window=recording-ready",
      });
    },
    ipc: ipcMain,
    screen: {
      getAllDisplays: () => screen.getAllDisplays(),
      getCursorDisplay: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
    },
    platform: process.platform,
  });
}
