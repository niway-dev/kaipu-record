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
import type { KeptQuietCapture, QuietCapture } from "./last-quiet-capture";
import type { SaveScreenshotMeta } from "./screenshot-save";

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
  /** Read the kept bytes without freeing them, with their capture sequence (`peekLastQuietCapture`). */
  peekQuietCapture(): KeptQuietCapture | null;
  /** Free the kept bytes if they still belong to capture `of` (`releaseLastQuietCapture`). */
  releaseQuietCapture(of: number): void;
  /** The user's Save to Library (`saveFromToast`); resolves the new item's id. */
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
  /** The pointer is over the card (last `screenshot:toast-hover`); reset when it hides. */
  private pointerInside = false;
  /** The toast generation whose Save is writing; a newer toast's Save is never blocked by it. */
  private savingGeneration: number | null = null;
  /** Annotate was pressed while that generation's Save was writing: it runs when the write ends. */
  private annotateAfterSave: number | null = null;
  /** `destroy()` ran: the app is quitting, so no window is created again. */
  private disposed = false;

  constructor(private readonly deps: CaptureToastDeps) {
    deps.ipc.on(IPC_CHANNELS.screenshotToastReady, (event) => {
      if (!this.isOwnSender(event.sender)) return;
      this.rendererReady = true;
      this.present();
      // The card is on screen only now: the 6 s count from here, not from `show`.
      if (this.payload) this.restartTimer();
    });
    deps.ipc.on(IPC_CHANNELS.screenshotToastHover, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const paused = (payload as { paused?: unknown } | undefined)?.paused;
      if (paused === true) {
        this.pointerInside = true;
        this.pause();
      } else if (paused === false) {
        this.pointerInside = false;
        this.resume();
      }
    });
    deps.ipc.on(IPC_CHANNELS.screenshotToastAction, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const action = (payload as { action?: unknown } | undefined)?.action;
      if (isCaptureToastAction(action)) this.act(action);
    });
  }

  /**
   * Show `request` on its display (re-targeting an open toast) and restart the 6 s: from now
   * when the renderer is up, else from when it reports ready. A pointer resting on the card
   * keeps holding it through the re-target.
   */
  show(request: CaptureToastShowRequest): void {
    if (this.disposed) return;
    const { displayId, ...payload } = request;
    this.generation += 1;
    this.annotateAfterSave = null;
    this.payload = payload;
    this.bounds = toastBounds(this.workAreaOf(displayId));
    this.paused = this.pointerInside;
    this.ensureWindow();
    this.present();
    if (this.rendererReady) this.restartTimer();
    else this.stopTimer();
  }

  /** The pointer is over the card: hold the auto-hide. */
  pause(): void {
    this.paused = true;
    this.stopTimer();
  }

  /** The pointer left the card: a full 6 s again. */
  resume(): void {
    // An Annotate waiting on the Save holds the toast until the write ends.
    if (!this.payload || this.annotateAfterSave === this.generation) return;
    this.paused = false;
    this.restartTimer();
  }

  /**
   * Hide the toast. The kept copy-only bytes stay: only a new capture, Annotate or a Save that
   * reached the vault frees them. An Annotate waiting on a Save is dropped with the toast.
   */
  dismiss(): void {
    this.stopTimer();
    this.payload = null;
    this.annotateAfterSave = null;
    // Hidden under a resting pointer, the card never reports it left.
    this.pointerInside = false;
    this.paused = false;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.hide();
    this.setSpaceBehavior(false);
  }

  /** Quit: dismiss, drop the window for good (no `beforeunload` round trip), never show again. */
  destroy(): void {
    this.disposed = true;
    this.dismiss();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
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
        } else if (this.savingGeneration === this.generation) {
          // Save is writing this very shot: open the vault item it is about to produce (one
          // item, failure 4), or the bytes if the write fails. The toast stays until then.
          this.annotateAfterSave = this.generation;
          this.stopTimer();
          return;
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

  /**
   * Save to Library on a copy-only toast: one vault write, then Open in Library. The bytes
   * are read, not taken, so Annotate keeps working while the write runs; they are freed only
   * once the vault has them, and only if no capture started since (its sequence).
   */
  private async save(payload: CaptureToastPayload): Promise<void> {
    const generation = this.generation;
    if (payload.saved || this.savingGeneration === generation) return;
    const kept = this.deps.peekQuietCapture();
    if (!kept) return;
    this.savingGeneration = generation;
    try {
      const saved = await this.deps.saveToVault(kept.capture.png, this.deps.title());
      this.deps.releaseQuietCapture(kept.sequence);
      // A newer capture replaced this toast while the write ran: its card stays.
      if (generation !== this.generation) return;
      const next = { ...payload, saved: { id: saved.id } };
      if (this.payload) this.payload = next;
      this.send(next);
      if (this.annotateAfterSave === generation) {
        this.deps.openSaved("editor", saved.id);
        this.dismiss();
      }
    } catch (error) {
      console.error("screenshot toast save failed", error);
      // Nothing was taken, so there is nothing to put back. An Annotate that waited gets the
      // bytes, if they are still this capture's (a capture that started since owns the store).
      if (generation !== this.generation || this.annotateAfterSave !== generation) return;
      if (this.deps.peekQuietCapture()?.sequence !== kept.sequence) return;
      const capture = this.deps.takeQuietCapture();
      if (capture) this.deps.openQuietCapture(capture);
      this.dismiss();
    } finally {
      if (this.savingGeneration === generation) this.savingGeneration = null;
      if (this.annotateAfterSave === generation) this.annotateAfterSave = null;
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
    // Second guard behind `beforeCapture` dismissing it: excluded from `screencapture` and
    // `desktopCapturer`, so a toast still on screen never lands in the next shot.
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
  | "peekQuietCapture"
  | "releaseQuietCapture"
  | "saveToVault"
  | "title"
  | "openSaved"
  | "openQuietCapture"
>;

/**
 * The toast's Save to Library as a vault write. `manual: false`, like the capture's auto-save:
 * a manual save stamps `editorSavedAt`, which puts the shot on the Editor home's Continue
 * list, and the editor never opened this shot.
 */
export function saveFromToast(
  save: (png: Buffer, meta: SaveScreenshotMeta) => Promise<{ id: string }>,
): CaptureToastDeps["saveToVault"] {
  return async (png, title) => {
    const saved = await save(png, { title, manual: false });
    return { id: saved.id };
  };
}

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
