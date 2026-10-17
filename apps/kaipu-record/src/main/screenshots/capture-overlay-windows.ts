import { BrowserWindow, ipcMain, screen } from "electron";
import type { BrowserWindowConstructorOptions, Display, Rectangle } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { OverlayAnswer, OverlayPort } from "./overlay-port";

export type OverlayUi = "area" | "screen" | "frame";

/** How long `hideAll` waits for the renderers' frame acks before capturing anyway. */
export const HIDDEN_ACK_CAP_MS = 250;

/** The slice of `BrowserWindow` the overlays use; a fake implements it in tests. */
export interface OverlayWindow {
  readonly webContents: { readonly id: number; send(channel: string, ...args: unknown[]): void };
  setAlwaysOnTop(flag: boolean, level?: "screen-saver"): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean },
  ): void;
  show(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
  once(event: "ready-to-show", listener: () => void): void;
  on(event: "closed", listener: () => void): void;
}

type SenderEvent = { sender: { id: number } };
type IpcListener = (event: SenderEvent, payload?: unknown) => void;

export interface CaptureOverlayDeps {
  platform: NodeJS.Platform;
  createWindow(options: BrowserWindowConstructorOptions): OverlayWindow;
  /** Load the renderer with `query` (e.g. `?window=capture-overlay&…`). */
  loadRenderer(window: OverlayWindow, query: string): void;
  ipc: {
    on(channel: string, listener: IpcListener): void;
  };
  screen: {
    on(event: "display-removed", listener: (event: unknown, display: Display) => void): void;
  };
  /** Where the pointer is, so the overlay under it takes keyboard focus (Esc, Enter, 1/2/3). */
  cursorPoint(): { x: number; y: number };
}

const electronDeps = (): CaptureOverlayDeps => ({
  platform: process.platform,
  createWindow: (options) => new BrowserWindow(options) as unknown as OverlayWindow,
  loadRenderer: (window, query) => {
    const browserWindow = window as unknown as BrowserWindow;
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void browserWindow.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${query}`);
    } else {
      void browserWindow.loadFile(join(__dirname, "../renderer/index.html"), { search: query });
    }
  },
  ipc: ipcMain as unknown as CaptureOverlayDeps["ipc"],
  screen: screen as unknown as CaptureOverlayDeps["screen"],
  cursorPoint: () => screen.getCursorScreenPoint(),
});

type OverlayEntry = { window: OverlayWindow; displayId: number };

type PickSession = {
  displayIds: Set<number>;
  /** Set until the first answer settles the pick; cleared after, so later answers are ignored. */
  settle: ((answer: OverlayAnswer) => void) | null;
};

type HiddenWait = { waiting: Set<number>; done: Promise<void>; finish: () => void };

function contains(bounds: Rectangle, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate a renderer answer: it crosses a process boundary, so its shape is not trusted. */
function parseAnswer(payload: unknown, displayIds: Set<number>): OverlayAnswer | null {
  if (!payload || typeof payload !== "object") return null;
  const answer = payload as Record<string, unknown>;
  if (answer.kind === "cancelled") return { kind: "cancelled" };
  if (!isFiniteNumber(answer.displayId) || !displayIds.has(answer.displayId)) return null;
  if (answer.kind === "display") return { kind: "display", displayId: answer.displayId };
  if (answer.kind !== "rect" || !answer.rect || typeof answer.rect !== "object") return null;
  const { x, y, width, height } = answer.rect as Record<string, unknown>;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return {
    kind: "rect",
    displayId: answer.displayId,
    rect: { x: x as number, y: y as number, width: width as number, height: height as number },
  };
}

/**
 * The capture overlay: one frameless, transparent, always-on-top window per display that
 * draws the Area drag, the Screen chooser or the Frame box (the renderer side lives in
 * `features/screenshots/overlay/`). It only ever answers "this rectangle / this display"
 * or "cancelled"; the provider captures the pixels.
 *
 * The provider drives one session: `pick` → answer → `hideAll` → capture → `destroyAll`.
 * `pick` does not destroy the windows when it settles, so the dim sheet never flashes
 * off and back before the shot; a second `pick` before `destroyAll` answers `cancelled`
 * without touching the session in progress.
 *
 * On macOS each overlay is a `panel` at the screen-saver level, so it floats over a
 * full-screen app on the Space the user is on, and it joins every Space only while it is
 * shown (the open-only Space toggle, same as `CapturePanelWindow`): kept on while hidden,
 * that membership leaves the app's menu bar black over a full-screen window.
 */
export class CaptureOverlayWindows implements OverlayPort {
  private readonly deps: CaptureOverlayDeps;
  private entries: OverlayEntry[] = [];
  private session: PickSession | null = null;
  private hiddenWait: HiddenWait | null = null;
  private hiding: Promise<void> | null = null;
  private hoverDisplayId: number | null = null;

  constructor(deps: Partial<CaptureOverlayDeps> = {}) {
    this.deps = { ...electronDeps(), ...deps };
    this.registerListeners();
  }

  pick(ui: OverlayUi, displays: Display[]): Promise<OverlayAnswer> {
    if (this.session || displays.length === 0) return Promise.resolve({ kind: "cancelled" });

    return new Promise<OverlayAnswer>((resolve) => {
      this.session = {
        displayIds: new Set(displays.map((display) => display.id)),
        settle: resolve,
      };
      this.hoverDisplayId = null;
      const cursor = this.deps.cursorPoint();
      const focused = Math.max(
        0,
        displays.findIndex((display) => contains(display.bounds, cursor)),
      );
      displays.forEach((display, index) => {
        this.entries.push(this.createOverlay(ui, display, index === focused));
      });
    });
  }

  hideAll(): Promise<void> {
    // One hide at a time: a second call shares the wait already running.
    this.hiding ??= this.hideAndWait().finally(() => {
      this.hiding = null;
    });
    return this.hiding;
  }

  private async hideAndWait(): Promise<void> {
    const live = this.liveEntries();
    if (live.length === 0) return;

    for (const { window } of live) {
      window.hide();
      this.setSpaceBehavior(window, false);
    }
    // The window server needs a tick to take the windows off screen …
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // … and each renderer one animation frame, so its last painted frame is gone too.
    const waiting = new Set(this.liveEntries().map(({ window }) => window.webContents.id));
    if (waiting.size === 0) return;
    let finish = (): void => {};
    const done = new Promise<void>((resolve) => {
      const cap = setTimeout(() => finish(), HIDDEN_ACK_CAP_MS);
      finish = () => {
        clearTimeout(cap);
        if (this.hiddenWait?.done === done) this.hiddenWait = null;
        resolve();
      };
    });
    this.hiddenWait = { waiting, done, finish };
    for (const { window } of this.liveEntries()) {
      window.webContents.send(IPC_CHANNELS.screenshotOverlayHiddenAck);
    }
    return done;
  }

  destroyAll(): void {
    const entries = this.entries;
    this.entries = [];
    const session = this.session;
    this.session = null;
    this.hoverDisplayId = null;
    for (const { window } of entries) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.hiddenWait?.finish();
    session?.settle?.({ kind: "cancelled" });
  }

  private createOverlay(ui: OverlayUi, display: Display, focus: boolean): OverlayEntry {
    const darwin = this.deps.platform === "darwin";
    const window = this.deps.createWindow({
      ...display.bounds,
      ...(darwin ? { type: "panel" } : {}),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      alwaysOnTop: true,
      focusable: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    // Above full-screen apps on macOS and above the taskbar on Windows.
    window.setAlwaysOnTop(true, "screen-saver");

    const entry: OverlayEntry = { window, displayId: display.id };
    window.once("ready-to-show", () => {
      // Answered or destroyed before it painted: never show a stale overlay.
      if (window.isDestroyed() || !this.session?.settle) return;
      this.setSpaceBehavior(window, true);
      window.show();
      if (focus) window.focus();
    });
    window.on("closed", () => this.forget(entry));

    this.deps.loadRenderer(
      window,
      `?window=capture-overlay&display=${display.id}&ui=${encodeURIComponent(ui)}`,
    );
    return entry;
  }

  /** Join every Space, full-screen ones included, while shown; leave them when hidden. */
  private setSpaceBehavior(window: OverlayWindow, open: boolean): void {
    if (this.deps.platform !== "darwin" || window.isDestroyed()) return;
    window.setVisibleOnAllWorkspaces(open, {
      visibleOnFullScreen: open,
      skipTransformProcessType: true,
    });
  }

  /** A window that went away on its own (crash, closed by the OS): cancel an open pick. */
  private forget(entry: OverlayEntry): void {
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    // A closed window can no longer ack; stop waiting for it.
    this.ackFrom(null);
    this.answer({ kind: "cancelled" });
  }

  private answer(answer: OverlayAnswer): void {
    const settle = this.session?.settle;
    if (!this.session || !settle) return;
    this.session.settle = null;
    settle(answer);
  }

  private ackFrom(senderId: number | null): void {
    const wait = this.hiddenWait;
    if (!wait) return;
    if (senderId !== null) wait.waiting.delete(senderId);
    const live = new Set(this.liveEntries().map(({ window }) => window.webContents.id));
    for (const id of wait.waiting) if (!live.has(id)) wait.waiting.delete(id);
    if (wait.waiting.size === 0) wait.finish();
  }

  private liveEntries(): OverlayEntry[] {
    return this.entries.filter(({ window }) => !window.isDestroyed());
  }

  private ownsSender(event: SenderEvent): boolean {
    return this.liveEntries().some(({ window }) => window.webContents.id === event.sender.id);
  }

  private registerListeners(): void {
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayAnswer, (event, payload) => {
      if (!this.session?.settle || !this.ownsSender(event)) return;
      const answer = parseAnswer(payload, this.session.displayIds);
      if (answer) this.answer(answer);
    });

    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayHover, (event, payload) => {
      if (!this.session || !this.ownsSender(event)) return;
      const displayId = (payload as { displayId?: unknown } | undefined)?.displayId;
      const next =
        isFiniteNumber(displayId) && this.session.displayIds.has(displayId) ? displayId : null;
      if (next === this.hoverDisplayId) return;
      this.hoverDisplayId = next;
      for (const { window } of this.liveEntries()) {
        window.webContents.send(IPC_CHANNELS.screenshotOverlayState, { hoverDisplayId: next });
      }
    });

    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayHiddenAck, (event) => {
      if (this.ownsSender(event)) this.ackFrom(event.sender.id);
    });

    // Failure 6: a display going away while the overlay is up cancels the whole pick,
    // and its window (now orphaned off-screen) goes with the rest.
    this.deps.screen.on("display-removed", (_event, display) => {
      if (!this.session?.settle || !this.session.displayIds.has(display.id)) return;
      this.destroyAll(); // settles the pick with `cancelled`
    });
  }
}
