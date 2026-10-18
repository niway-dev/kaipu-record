import { BrowserWindow, ipcMain, screen } from "electron";
import type { BrowserWindowConstructorOptions, Display, Rectangle } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  isCaptureMode,
  type CaptureAction,
  type CaptureMode,
  type ListedWindow,
  type OverlayState,
} from "@shared/types/screenshot-capture";
import {
  NO_WINDOWS_LISTER,
  type OverlayAnswer,
  type OverlayPort,
  type WindowLister,
} from "./overlay-port";

export type OverlayUi = CaptureMode;

/** How long `hideAll` waits for the renderers' frame acks before capturing anyway. */
export const HIDDEN_ACK_CAP_MS = 250;

/** How long every overlay has to reach `ready-to-show` before the pick is abandoned. */
export const OVERLAY_READY_TIMEOUT_MS = 10_000;

/** Chromium's `ERR_ABORTED`: a navigation superseded or cancelled, not a failed load. */
const ERR_ABORTED = -3;

/** The slice of Electron's `Input` the Escape handler reads. */
export type OverlayInput = { type: string; key: string };

/** The slice of `BrowserWindow` the overlays use; a fake implements it in tests. */
export interface OverlayWindow {
  readonly webContents: {
    readonly id: number;
    send(channel: string, ...args: unknown[]): void;
    on(event: "render-process-gone" | "unresponsive", listener: () => void): void;
    on(
      event: "did-fail-load",
      listener: (
        event: unknown,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => void,
    ): void;
    on(
      event: "before-input-event",
      listener: (event: { preventDefault(): void }, input: OverlayInput) => void,
    ): void;
  };
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
  /** The primary display, the Frame's fallback when no picked display holds the pointer. */
  primaryDisplayId(): number | null;
  /** Watchdog: abandon the pick if the overlays have not all painted within this long. */
  readyTimeoutMs: number;
  /**
   * Window mode's list of on-screen windows, asked once per pick. Production passes the OS
   * lister (`createWindowLister`); the default finds nothing, so tests never spawn a process.
   */
  windowLister: WindowLister;
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
  primaryDisplayId: () => screen.getPrimaryDisplay().id,
  readyTimeoutMs: OVERLAY_READY_TIMEOUT_MS,
  windowLister: NO_WINDOWS_LISTER,
});

type OverlayEntry = { window: OverlayWindow; displayId: number };

type PickSession = {
  displays: Display[];
  displayIds: Set<number>;
  /** Set once the window lister has been asked; it is asked at most once per pick. */
  windowsRequested: boolean;
  /** Set until the first answer settles the pick; cleared after, so later answers are ignored. */
  settle: ((answer: OverlayAnswer) => void) | null;
  /** Windows that have reached `ready-to-show` and been shown. */
  shown: number;
  /** Fires `destroyAll` when the overlays never all paint; cleared once they have. */
  watchdog: ReturnType<typeof setTimeout> | null;
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

function rectParam({ x, y, width, height }: Rectangle): string {
  return `${x},${y},${width},${height}`;
}

/**
 * The overlay's render-target query: everything the renderer needs to draw, so it never
 * has to ask main. `index` is 1-based among the picked displays; `bounds` and `work` are
 * the display's bounds and work area in DIP. `ids` lists every picked display in order,
 * so whichever overlay has keyboard focus can map the digit N to the N-th display.
 * `frame` (Frame only) is the display that starts with the frame, so each overlay paints
 * the right thing at once instead of waiting for the first state message. `internal=1`
 * marks the built-in display, which the Screen card labels "Built-in".
 */
export function overlayQuery(
  ui: OverlayUi,
  display: Display,
  index: number,
  displayIds: readonly number[],
  frameDisplayId: number | null = null,
): string {
  return (
    `?window=capture-overlay&display=${display.id}&ui=${ui}` +
    `&index=${index}&count=${displayIds.length}` +
    `&bounds=${rectParam(display.bounds)}&work=${rectParam(display.workArea)}` +
    `&ids=${displayIds.join(",")}` +
    (ui === "frame" && frameDisplayId !== null ? `&frame=${frameDisplayId}` : "") +
    (display.internal ? "&internal=1" : "")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAction(value: unknown): CaptureAction | null {
  // An answer without an action is a plain Capture; anything else must be a known action.
  if (value === undefined) return "capture";
  return value === "capture" || value === "copy" ? value : null;
}

function parseRect(value: unknown): Rectangle | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every(isFiniteNumber)) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/**
 * Validate a renderer answer: it crosses a process boundary, so its shape is not trusted.
 * Each kind must carry its own mode, because providers capture by `answer.mode`.
 */
function parseAnswer(
  payload: unknown,
  displayIds: Set<number>,
  windows: readonly ListedWindow[] | null,
): OverlayAnswer | null {
  if (!payload || typeof payload !== "object") return null;
  const answer = payload as Record<string, unknown>;
  if (answer.kind === "cancelled") return { kind: "cancelled" };
  if (!isFiniteNumber(answer.displayId) || !displayIds.has(answer.displayId)) return null;
  const action = parseAction(answer.action);
  if (!action) return null;
  const displayId = answer.displayId;
  if (answer.kind === "display") {
    if (answer.mode !== undefined && answer.mode !== "screen") return null;
    return { kind: "display", mode: "screen", action, displayId };
  }
  const rect = parseRect(answer.rect);
  if (!rect) return null;
  if (answer.kind === "rect") {
    if (answer.mode !== undefined && answer.mode !== "frame") return null;
    return { kind: "rect", mode: "frame", action, displayId, rect };
  }
  if (answer.kind === "window") {
    if (answer.mode !== undefined && answer.mode !== "window") return null;
    if (typeof answer.windowId !== "string" || answer.windowId === "") return null;
    // Only a window the lister put on that display: a stale or forged id is not captured.
    const { windowId } = answer;
    if (!windows?.some((listed) => listed.id === windowId && listed.displayId === displayId)) {
      return null;
    }
    return { kind: "window", mode: "window", action, displayId, windowId: answer.windowId, rect };
  }
  return null;
}

/**
 * The capture overlay: one frameless, transparent, always-on-top window per display that
 * draws the Frame box, the Window picker or the Screen chooser (the renderer side lives in
 * `features/screenshots/overlay/`). It only ever answers "this rectangle / this window / this display"
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
 *
 * One instance per process: the constructor registers IPC and `screen` listeners that
 * live as long as the app. Do not construct one per pick, or the handlers stack up.
 */
export class CaptureOverlayWindows implements OverlayPort {
  private readonly deps: CaptureOverlayDeps;
  private entries: OverlayEntry[] = [];
  private session: PickSession | null = null;
  private hiddenWait: HiddenWait | null = null;
  private hiding: Promise<void> | null = null;
  /** The mode every overlay renders right now. */
  private mode: CaptureMode = "frame";
  private hoverDisplayId: number | null = null;
  /** Frame mode only: the one display that shows the frame; `null` in every other mode. */
  private frameDisplayId: number | null = null;
  /** The display whose window takes keyboard focus when shown (and when the frame moves). */
  private focusDisplayId: number | null = null;
  /** Window mode's list: `null` until the lister answers, `[]` when it found none. */
  private windows: ListedWindow[] | null = null;

  constructor(deps: Partial<CaptureOverlayDeps> = {}) {
    this.deps = { ...electronDeps(), ...deps };
    this.registerListeners();
  }

  pick(ui: OverlayUi, displays: Display[]): Promise<OverlayAnswer> {
    if (this.session || displays.length === 0) return Promise.resolve({ kind: "cancelled" });

    return new Promise<OverlayAnswer>((resolve) => {
      this.session = {
        displays,
        displayIds: new Set(displays.map((display) => display.id)),
        windowsRequested: false,
        settle: resolve,
        shown: 0,
        watchdog: null,
      };
      this.mode = ui;
      this.hoverDisplayId = null;
      this.windows = null;
      const cursor = this.deps.cursorPoint();
      const underCursor = displays.findIndex((display) => contains(display.bounds, cursor));
      // One frame at a time: it starts where the pointer is, else on the primary display
      // (else the first picked one), and the user moves it by clicking another display.
      if (ui === "frame") {
        const primary = this.deps.primaryDisplayId();
        this.frameDisplayId = (
          displays[underCursor] ??
          displays.find((display) => display.id === primary) ??
          displays[0]
        ).id;
      } else {
        this.frameDisplayId = null;
      }
      // Keyboard focus (Esc, Enter, 1/2/3): the Frame's Enter only works in the window
      // that holds the frame, so there focus follows the frame, not the pointer.
      this.focusDisplayId = this.frameDisplayId ?? displays[Math.max(0, underCursor)].id;
      const displayIds = displays.map((display) => display.id);
      displays.forEach((display, index) => {
        this.entries.push(this.createOverlay(ui, display, index + 1, displayIds));
      });
      // Window from the start: list in parallel with the overlays painting.
      if (ui === "window") this.requestWindows();
      // Nothing else rescues a pick whose overlays never paint: the app is hidden and
      // every later capture would answer `cancelled` until restart.
      const session = this.session;
      session.watchdog = setTimeout(() => {
        session.watchdog = null;
        if (this.session === session) this.destroyAll();
      }, this.deps.readyTimeoutMs);
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

  setWindows(list: ListedWindow[]): void {
    if (!this.session) return;
    this.windows = list;
    this.broadcastState();
  }

  /**
   * Ask the lister once per pick. Failure 2: a lister that throws or rejects answers an
   * empty list, so Window says "No windows on this display" instead of hanging; a list
   * that lands after its pick ended is dropped.
   */
  private requestWindows(): void {
    const session = this.session;
    if (!session || session.windowsRequested) return;
    session.windowsRequested = true;
    let listing: Promise<ListedWindow[]>;
    try {
      listing = this.deps.windowLister.list(session.displays);
    } catch (error) {
      listing = Promise.reject(error);
    }
    void listing
      .then((list) => (Array.isArray(list) ? list : []))
      .catch((error: unknown) => {
        console.warn("[screenshot] window list failed", error);
        return [];
      })
      .then((list) => {
        if (this.session === session) this.setWindows(list);
      });
  }

  destroyAll(): void {
    const entries = this.entries;
    this.entries = [];
    const session = this.session;
    this.session = null;
    this.hoverDisplayId = null;
    this.frameDisplayId = null;
    this.focusDisplayId = null;
    this.windows = null;
    if (session?.watchdog) clearTimeout(session.watchdog);
    for (const { window } of entries) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.hiddenWait?.finish();
    session?.settle?.({ kind: "cancelled" });
  }

  private createOverlay(
    ui: OverlayUi,
    display: Display,
    index: number,
    displayIds: readonly number[],
  ): OverlayEntry {
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
      // macOS: the first click on an overlay that is not the key window must act (pick
      // that display, grab a handle), not merely make the window key.
      acceptFirstMouse: true,
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
      if (display.id === this.focusDisplayId) window.focus();
      // A renderer that loaded after the last broadcast still learns where the frame is.
      this.sendState(window);
      const session = this.session;
      session.shown += 1;
      if (session.shown >= this.entries.length && session.watchdog) {
        clearTimeout(session.watchdog);
        session.watchdog = null;
      }
    });
    window.on("closed", () => this.forget(entry));
    // A crashed renderer leaves its window open: invisible, screen-covering and eating
    // clicks, with no overlay left to press Esc in. Cancel and tear the session down.
    window.webContents.on("render-process-gone", () => {
      if (this.entries.includes(entry)) this.destroyAll();
    });
    // A load that fails or a renderer that hangs leaves a window nobody can answer.
    window.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
      if (errorCode === ERR_ABORTED || isMainFrame === false) return;
      if (this.entries.includes(entry)) this.destroyAll();
    });
    window.webContents.on("unresponsive", () => {
      if (this.entries.includes(entry)) this.destroyAll();
    });
    // Esc from main, so cancelling does not depend on which renderer holds keyboard focus.
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape") return;
      if (!this.entries.includes(entry)) return;
      event.preventDefault();
      this.answer({ kind: "cancelled" });
    });

    this.deps.loadRenderer(
      window,
      overlayQuery(ui, display, index, displayIds, this.frameDisplayId),
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
    // A late `closed` from an earlier session must not cancel the current one.
    if (!this.entries.includes(entry)) return;
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    // A closed window can no longer ack; stop waiting for it.
    this.ackFrom(null);
    this.answer({ kind: "cancelled" });
  }

  private sendState(window: OverlayWindow): void {
    const state: OverlayState = {
      mode: this.mode,
      hoverDisplayId: this.hoverDisplayId,
      frameDisplayId: this.frameDisplayId,
      windows: this.windows,
    };
    window.webContents.send(IPC_CHANNELS.screenshotOverlayState, state);
  }

  private broadcastState(): void {
    for (const { window } of this.liveEntries()) this.sendState(window);
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

  private displayOf(event: SenderEvent): number | null {
    const entry = this.liveEntries().find(
      ({ window }) => window.webContents.id === event.sender.id,
    );
    return entry ? entry.displayId : null;
  }

  private ownsSender(event: SenderEvent): boolean {
    return this.liveEntries().some(({ window }) => window.webContents.id === event.sender.id);
  }

  private registerListeners(): void {
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayAnswer, (event, payload) => {
      if (!this.session?.settle || !this.ownsSender(event)) return;
      const answer = parseAnswer(payload, this.session.displayIds, this.windows);
      if (answer) this.answer(answer);
    });

    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayHover, (event, payload) => {
      if (!this.session || !this.ownsSender(event)) return;
      const displayId = (payload as { displayId?: unknown } | undefined)?.displayId;
      const next =
        isFiniteNumber(displayId) && this.session.displayIds.has(displayId) ? displayId : null;
      // Two renderers race when the pointer crosses displays: A's "left" can arrive after
      // B's "entered". Only the hovered display's own window may clear the hover.
      if (next === null && this.displayOf(event) !== this.hoverDisplayId) return;
      if (next === this.hoverDisplayId) return;
      this.hoverDisplayId = next;
      this.broadcastState();
    });

    // Frame mode: a click on a display that does not hold the frame moves it there.
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayFrameDisplay, (event, payload) => {
      if (!this.session?.settle || this.frameDisplayId === null || !this.ownsSender(event)) return;
      const displayId = (payload as { displayId?: unknown } | undefined)?.displayId;
      if (!isFiniteNumber(displayId) || !this.session.displayIds.has(displayId)) return;
      if (displayId === this.frameDisplayId) return;
      this.frameDisplayId = displayId;
      this.focusDisplayId = displayId;
      // Enter lives in the window that now holds the frame: make it the key window.
      const target = this.liveEntries().find((entry) => entry.displayId === displayId);
      target?.window.focus();
      this.broadcastState();
    });

    // The mode pill (or keys 1–3) on any overlay: every overlay re-renders in that mode.
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayMode, (event, payload) => {
      if (!this.session?.settle) return;
      const sender = this.displayOf(event);
      if (sender === null) return;
      const mode = (payload as { mode?: unknown } | undefined)?.mode;
      if (!isCaptureMode(mode) || mode === this.mode) return;
      this.mode = mode;
      // The frame lives only in Frame; entering it puts it where the user asked from.
      this.frameDisplayId = mode === "frame" ? sender : null;
      if (mode === "frame") {
        this.focusDisplayId = sender;
        this.liveEntries()
          .find((entry) => entry.displayId === sender)
          ?.window.focus();
      }
      if (mode === "window") this.requestWindows();
      this.broadcastState();
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
