import { BrowserWindow, ipcMain, screen } from "electron";
import type { BrowserWindowConstructorOptions, Rectangle } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  isCaptureToastAction,
  type CaptureToastAction,
  type CaptureToastPayload,
} from "@shared/types/screenshot-capture";
import type { QuietCapture } from "./last-quiet-capture";

/** The card's window, in DIP (the card itself is drawn by the renderer inside it). */
export const TOAST_WIDTH = 380;
export const TOAST_HEIGHT = 150;
/** Gap between the toast and the work area's top and right edges. */
export const TOAST_MARGIN = 18;
/** The toast hides itself this long after it appears, unless the pointer is over it. */
export const TOAST_AUTO_HIDE_MS = 6_000;

/** What `show` takes: the payload the card renders, plus the display the shot came from. */
export type CaptureToastShowRequest = CaptureToastPayload & { displayId: number };

/** The slice of `BrowserWindow` the toast uses, so tests can pass a fake. */
export interface ToastWindow {
  readonly webContents: { send(channel: string, payload: unknown): void };
  setAlwaysOnTop(flag: boolean, level: "floating"): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options: { visibleOnFullScreen: boolean; skipTransformProcessType: boolean },
  ): void;
  setBounds(bounds: Rectangle): void;
  showInactive(): void;
  hide(): void;
  isDestroyed(): boolean;
  on(event: "closed", listener: () => void): void;
}

type IpcListener = (event: { sender: unknown }, payload?: unknown) => void;

export interface CaptureToastDeps {
  createWindow(options: BrowserWindowConstructorOptions): ToastWindow;
  /** Load `?window=capture-toast` into the window. */
  load(window: ToastWindow): void;
  ipc: { on(channel: string, listener: IpcListener): void };
  screen: {
    getAllDisplays(): Array<{ id: number; workArea: Rectangle }>;
    getPrimaryDisplay(): { id: number; workArea: Rectangle };
  };
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  platform: NodeJS.Platform;
  /** Hand the copy-only capture's bytes to one consumer (`takeLastQuietCapture`). */
  takeQuietCapture(): QuietCapture | null;
  /** Put bytes back after a Save that failed (`keepLastQuietCapture`). */
  keepQuietCapture(capture: QuietCapture): void;
  /** The user's Save to Library: a manual vault write; resolves the new item's id. */
  saveToVault(png: Buffer, title: string): Promise<{ id: string }>;
  /** Title of the saved shot (`screenshotTitle()`). */
  title(): string;
  /** Show a saved item in the main window (editor or Library page) and reveal it. */
  openSaved(target: "editor" | "library", id: string): void;
  /** Open a copy-only capture's bytes in the main window's editor and reveal it. */
  openQuietCapture(capture: QuietCapture): void;
}

/**
 * Top-right of `workArea`, `TOAST_MARGIN` in from both edges. Clamped to the work area's
 * left edge, so a display narrower than the toast (or one left of the primary, whose x is
 * negative) still shows all of it that fits, never a sliver off screen.
 */
export function toastBounds(workArea: Rectangle): Rectangle {
  const right = workArea.x + workArea.width - TOAST_WIDTH - TOAST_MARGIN;
  return {
    x: Math.round(Math.max(workArea.x, right)),
    y: Math.round(workArea.y + TOAST_MARGIN),
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
  };
}

/**
 * The capture toast (spec decision 7): one frameless, always-on-top window at the top-right
 * of the display a quiet capture came from. It says what happened ("Copied to clipboard",
 * "Saved to Library") and offers Annotate and Open in Library / Save to Library. It is
 * the one window allowed on screen while the main window stays hidden after a quiet
 * capture, so it never activates the app (`focusable: false`, `showInactive`).
 *
 * A second capture re-targets the same window (failure 6). Like the tray panel, it joins
 * every Space, full-screen ones included, only while shown: kept on while hidden, that
 * membership blanks the app's own menu bar over a full-screen Kaipu window.
 */
export class CaptureToastWindow {
  private window: ToastWindow | null = null;
  /** The toast renderer subscribed to `screenshot:toast-show`; sends before that are lost. */
  private rendererReady = false;
  private payload: CaptureToastPayload | null = null;
  private bounds: Rectangle | null = null;
  /** Bumped on every `show`, so a Save that finishes late cannot repaint a newer toast. */
  private generation = 0;
  private timer: unknown = null;
  private paused = false;
  private saving = false;

  constructor(private readonly deps: CaptureToastDeps) {
    deps.ipc.on(IPC_CHANNELS.screenshotToastReady, (event) => {
      if (!this.isOwnSender(event.sender)) return;
      this.rendererReady = true;
      this.present();
    });
    deps.ipc.on(IPC_CHANNELS.screenshotToastHover, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const paused = (payload as { paused?: unknown } | undefined)?.paused;
      if (paused === true) this.pause();
      else if (paused === false) this.resume();
    });
    deps.ipc.on(IPC_CHANNELS.screenshotToastAction, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const action = (payload as { action?: unknown } | undefined)?.action;
      if (isCaptureToastAction(action)) this.act(action);
    });
  }

  /** Show `request` on its display (re-targeting an open toast) and restart the 6 s. */
  show(request: CaptureToastShowRequest): void {
    const { displayId, ...payload } = request;
    this.generation += 1;
    this.payload = payload;
    this.bounds = toastBounds(this.workAreaOf(displayId));
    this.paused = false;
    this.ensureWindow();
    this.present();
    this.restartTimer();
  }

  /** The pointer is over the card: hold the auto-hide. */
  pause(): void {
    this.paused = true;
    this.stopTimer();
  }

  /** The pointer left the card: a full 6 s again. */
  resume(): void {
    if (!this.payload) return;
    this.paused = false;
    this.restartTimer();
  }

  /** Hide the toast. The kept copy-only bytes stay: only a new capture or Annotate frees them. */
  dismiss(): void {
    this.stopTimer();
    this.payload = null;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
    this.setSpaceBehavior(false);
  }

  private act(action: CaptureToastAction): void {
    const payload = this.payload;
    if (!payload) return;
    switch (action) {
      case "dismiss":
        this.dismiss();
        return;
      case "annotate": {
        if (payload.saved) {
          this.deps.openSaved("editor", payload.saved.id);
        } else {
          // Exactly once: the bytes leave the store as they are handed over.
          const capture = this.deps.takeQuietCapture();
          if (!capture) return;
          this.deps.openQuietCapture(capture);
        }
        this.dismiss();
        return;
      }
      case "open-library":
        if (!payload.saved) return;
        this.deps.openSaved("library", payload.saved.id);
        this.dismiss();
        return;
      case "save":
        void this.save(payload);
        return;
    }
  }

  /** Save to Library on a copy-only toast: one manual vault write, then Open in Library. */
  private async save(payload: CaptureToastPayload): Promise<void> {
    if (payload.saved || this.saving) return;
    const capture = this.deps.takeQuietCapture();
    if (!capture) return;
    const generation = this.generation;
    this.saving = true;
    try {
      const saved = await this.deps.saveToVault(capture.png, this.deps.title());
      // A newer capture replaced this toast while the write ran: its card stays.
      if (generation !== this.generation) return;
      const next = { ...payload, saved: { id: saved.id } };
      if (this.payload) this.payload = next;
      this.send(next);
    } catch (error) {
      console.error("screenshot toast save failed", error);
      // Annotate still has the bytes, unless a newer capture already replaced them.
      if (generation === this.generation) this.deps.keepQuietCapture(capture);
    } finally {
      this.saving = false;
    }
  }

  private ensureWindow(): void {
    if (this.window && !this.window.isDestroyed()) return;
    this.rendererReady = false;
    const window = this.deps.createWindow({
      width: TOAST_WIDTH,
      height: TOAST_HEIGHT,
      // macOS: a panel is what can float over a full-screen app (hub page
      // desktop/floating-windows-over-full-screen).
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
      // Never takes focus, so showing it never brings the app (or its main window) forward.
      focusable: false,
      // The first click on a window of an inactive app lands on the button.
      acceptFirstMouse: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
      },
    });
    window.setAlwaysOnTop(true, "floating");
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
    if (this.bounds) window.setBounds(this.bounds);
    this.send(this.payload);
    this.setSpaceBehavior(true);
    window.showInactive();
  }

  private send(payload: CaptureToastPayload): void {
    if (!this.window || this.window.isDestroyed() || !this.rendererReady) return;
    this.window.webContents.send(IPC_CHANNELS.screenshotToastShow, payload);
  }

  private restartTimer(): void {
    this.stopTimer();
    if (this.paused) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.dismiss();
    }, TOAST_AUTO_HIDE_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Join every Space, full-screen ones included, while shown; leave them when hidden. */
  private setSpaceBehavior(open: boolean): void {
    if (this.deps.platform !== "darwin" || !this.window || this.window.isDestroyed()) return;
    this.window.setVisibleOnAllWorkspaces(open, {
      visibleOnFullScreen: open,
      skipTransformProcessType: true,
    });
  }

  private workAreaOf(displayId: number): Rectangle {
    const display =
      this.deps.screen.getAllDisplays().find((candidate) => candidate.id === displayId) ??
      this.deps.screen.getPrimaryDisplay();
    return display.workArea;
  }

  private isOwnSender(sender: unknown): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && sender === this.window.webContents);
  }
}

/** The app side of the toast: what index.ts provides (the main window and the vault). */
export type CaptureToastAppDeps = Pick<
  CaptureToastDeps,
  | "takeQuietCapture"
  | "keepQuietCapture"
  | "saveToVault"
  | "title"
  | "openSaved"
  | "openQuietCapture"
>;

/** The production toast: real `BrowserWindow`, `screen`, `ipcMain` and timers. */
export function createCaptureToastWindow(app: CaptureToastAppDeps): CaptureToastWindow {
  return new CaptureToastWindow({
    ...app,
    createWindow: (options) => new BrowserWindow(options),
    load: (window) => {
      const browserWindow = window as BrowserWindow;
      if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        void browserWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/?window=capture-toast`);
      } else {
        void browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
          search: "?window=capture-toast",
        });
      }
    },
    ipc: ipcMain,
    screen: {
      getAllDisplays: () => screen.getAllDisplays(),
      getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    },
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    platform: process.platform,
  });
}
