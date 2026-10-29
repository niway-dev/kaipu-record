import { BrowserWindow, ipcMain, screen } from "electron";
import type { BrowserWindowConstructorOptions, Display, Rectangle } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  ENABLED_CAPTURE_MODES,
  isCaptureAction,
  isCaptureIntent,
  isCaptureMode,
  isRecordingRatio,
  type CaptureAction,
  type CaptureIntent,
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
import { markRecordTiming } from "../recording/record-timing";

export type OverlayUi = CaptureMode;

/** How long `hideAll` waits for the renderers' frame acks before capturing anyway. */
export const HIDDEN_ACK_CAP_MS = 250;

/** How long every overlay has to reach `ready-to-show` before the pick is abandoned. */
export const OVERLAY_READY_TIMEOUT_MS = 10_000;

/** How long after a pick ends the next pick's windows start loading (the shot or take goes first). */
export const OVERLAY_WARM_DELAY_MS = 2000;

/** How often a warm-up that found the app busy (a take) tries again. */
export const OVERLAY_WARM_RETRY_MS = 5000;

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
  showInactive(): void;
  hide(): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
  once(event: "ready-to-show", listener: () => void): void;
  on(event: "closed", listener: () => void): void;
}

/**
 * Pre-loading the next pick's windows (spares). Each overlay window is a full renderer, and
 * loading one per display at every pick is most of the wait before the overlay shows. With a
 * warm-up, the windows of the most likely next pick load hidden once a pick ends, and that
 * pick shows them at once.
 */
export interface OverlayWarmup {
  /**
   * What the next pick most likely opens, given the intent of the last one (`null` before the
   * first): `null` when no overlay is worth pre-loading.
   */
  next(
    lastIntent: CaptureIntent | null,
  ): { ui: OverlayUi; intent: CaptureIntent; displays: Display[] } | null;
  /** False while loading windows would compete with something (a take): tried again later. */
  canWarm(): boolean;
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
    on(
      event: "display-removed" | "display-added" | "display-metrics-changed",
      listener: (event: unknown, display: Display) => void,
    ): void;
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
  /**
   * The modes the user can reach. A mode switch to anything else is ignored and the lister
   * never starts while `window` is missing. Defaults to `ENABLED_CAPTURE_MODES`.
   */
  enabledModes: readonly CaptureMode[];
  /** Keep the next pick's windows loaded hidden (see `OverlayWarmup`); none when absent. */
  warmup: OverlayWarmup | null;
  /** The warm-up's delays; tests shorten them. */
  warmDelayMs: number;
  warmRetryMs: number;
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
  enabledModes: ENABLED_CAPTURE_MODES,
  warmup: null,
  warmDelayMs: OVERLAY_WARM_DELAY_MS,
  warmRetryMs: OVERLAY_WARM_RETRY_MS,
});

type OverlayEntry = {
  window: OverlayWindow;
  displayId: number;
  /** Its renderer painted (`ready-to-show`): a spare that did is shown at once by its pick. */
  ready: boolean;
};

/** Windows loaded hidden for a pick that has not opened yet; `key` is their joined queries. */
type Spares = { key: string; entries: OverlayEntry[] };

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
  intent: CaptureIntent = "capture",
): string {
  return (
    `?window=capture-overlay&display=${display.id}&ui=${ui}` +
    `&index=${index}&count=${displayIds.length}` +
    `&bounds=${rectParam(display.bounds)}&work=${rectParam(display.workArea)}` +
    `&ids=${displayIds.join(",")}` +
    (ui === "frame" && frameDisplayId !== null ? `&frame=${frameDisplayId}` : "") +
    (display.internal ? "&internal=1" : "") +
    // Only the record intent is written: every screenshot query stays exactly as it was.
    // The scale only feeds the record intent's size readout (device pixels).
    (intent === "record" ? `&intent=record&scale=${display.scaleFactor}` : "")
  );
}

/**
 * The query of a spare: everything that needs a reload (the display, its geometry and scale,
 * the picked set) and nothing a loaded window can be told by message. The mode, the intent and
 * the frame's display reach it as state when its pick opens (`sendState`), so the same spare
 * serves Frame or Screen, record or capture, with the pointer on any display. `spare=1` makes
 * the renderer paint nothing until that first state arrives; `ui=frame` is only a placeholder.
 */
export function overlaySpareQuery(
  display: Display,
  index: number,
  displayIds: readonly number[],
): string {
  return (
    `?window=capture-overlay&display=${display.id}&ui=frame` +
    `&index=${index}&count=${displayIds.length}` +
    `&bounds=${rectParam(display.bounds)}&work=${rectParam(display.workArea)}` +
    `&ids=${displayIds.join(",")}` +
    (display.internal ? "&internal=1" : "") +
    `&scale=${display.scaleFactor}&spare=1`
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAction(value: unknown): CaptureAction | null {
  // An answer without an action is a plain Capture; anything else must be a known action.
  if (value === undefined) return "capture";
  return isCaptureAction(value) ? value : null;
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
  if (answer.kind === "window") {
    if (answer.mode !== undefined && answer.mode !== "window") return null;
    if (typeof answer.windowId !== "string" || answer.windowId === "") return null;
    // Only a window the lister put on that display: a stale or forged id is not captured.
    const { windowId } = answer;
    const listed = windows?.find(
      (candidate) => candidate.id === windowId && candidate.displayId === displayId,
    );
    if (!listed) return null;
    // The geometry comes from main's own list, never from the renderer's copy of it.
    return {
      kind: "window",
      mode: "window",
      action,
      displayId,
      windowId,
      rect: { ...listed.rect },
      fullSize: { ...listed.fullSize },
    };
  }
  const rect = parseRect(answer.rect);
  if (!rect) return null;
  if (answer.kind === "rect") {
    if (answer.mode !== undefined && answer.mode !== "frame") return null;
    // A ratio is kept only when it names a chip; anything else reads as unlocked.
    const ratio = isRecordingRatio(answer.ratio) ? answer.ratio : undefined;
    return ratio
      ? { kind: "rect", mode: "frame", action, displayId, rect, ratio }
      : { kind: "rect", mode: "frame", action, displayId, rect };
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
  /** Why the current session opened; written into every overlay's query. */
  private intent: CaptureIntent = "capture";
  private hoverDisplayId: number | null = null;
  /** Frame mode only: the one display that shows the frame; `null` in every other mode. */
  private frameDisplayId: number | null = null;
  /** The display whose window takes keyboard focus when shown (and when the frame moves). */
  private focusDisplayId: number | null = null;
  /** Window mode's list: `null` until the lister answers, `[]` when it found none. */
  private windows: ListedWindow[] | null = null;
  /** The next pick's windows, loaded hidden (see `OverlayWarmup`). */
  private spares: Spares | null = null;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Why the last pick opened (after any P / V switch): the warm-up guesses the next from it. */
  private lastIntent: CaptureIntent | null = null;
  /** `dispose()` ran: the app is quitting, so no window is loaded again. */
  private disposed = false;

  constructor(deps: Partial<CaptureOverlayDeps> = {}) {
    this.deps = { ...electronDeps(), ...deps };
    this.registerListeners();
  }

  pick(
    requested: OverlayUi,
    displays: Display[],
    intent: CaptureIntent = "capture",
  ): Promise<OverlayAnswer> {
    if (this.session || displays.length === 0) return Promise.resolve({ kind: "cancelled" });
    // A disabled mode opens in Frame, the same fallback the page and the tray show.
    const ui: OverlayUi = this.deps.enabledModes.includes(requested) ? requested : "frame";

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
      this.intent = intent;
      this.hoverDisplayId = null;
      this.windows = null;
      const { frameDisplayId, underCursor } = this.initialFrame(ui, displays);
      this.frameDisplayId = frameDisplayId;
      // Keyboard focus (Esc, Enter, 1/2/3): the Frame's Enter only works in the window
      // that holds the frame, so there focus follows the frame, not the pointer.
      this.focusDisplayId = this.frameDisplayId ?? displays[Math.max(0, underCursor)].id;
      const queries = this.queriesFor(ui, displays, frameDisplayId, intent);
      // Spares loaded for the same displays are used as they are, whatever the mode, intent or
      // frame display: those reach them as state. Any others (the displays changed) are
      // thrown away, and this pick loads its own as it always did.
      const spares = this.spares;
      this.spares = null;
      if (spares && spares.key === this.spareQueries(displays).join("|")) {
        markRecordTiming("overlay spares reused");
        this.entries.push(...spares.entries);
      } else {
        markRecordTiming("overlay loaded fresh");
        this.destroySpares(spares);
        displays.forEach((display, index) => {
          this.entries.push(this.createOverlay(display, queries[index]!));
        });
      }
      // Window from the start: list in parallel with the overlays painting. On Windows the
      // PowerShell lister is slow to start (Add-Type compiles C#), so it starts with every
      // pick: by the time the user presses 2, the list has usually landed.
      if (ui === "window" || this.deps.platform === "win32") this.requestWindows();
      // Nothing else rescues a pick whose overlays never paint: the app is hidden and
      // every later capture would answer `cancelled` until restart.
      const session = this.session;
      session.watchdog = setTimeout(() => {
        session.watchdog = null;
        if (this.session === session) this.destroyAll();
      }, this.deps.readyTimeoutMs);
      // Spares that already painted are shown now; the others when they do.
      for (const entry of this.entries) if (entry.ready) this.reveal(entry);
    });
  }

  /**
   * Load the next pick's windows now, hidden (see `OverlayWarmup`). Main calls it once the
   * app has started; every pick that ends schedules it again by itself. No-op without a
   * warm-up, while a pick is open, or when spares are already loaded.
   */
  prewarm(): void {
    this.scheduleWarm(0);
  }

  /** Throw the spares away and load them again (the next pick changed: mode, language). */
  refreshSpares(): void {
    if (!this.spares) return;
    this.destroySpares(this.spares);
    this.spares = null;
    this.scheduleWarm(this.deps.warmDelayMs);
  }

  /**
   * One frame at a time: it starts where the pointer is, else on the primary display (else
   * the first picked one), and the user moves it by clicking another display.
   */
  private initialFrame(
    ui: OverlayUi,
    displays: Display[],
  ): { frameDisplayId: number | null; underCursor: number } {
    const cursor = this.deps.cursorPoint();
    const underCursor = displays.findIndex((display) => contains(display.bounds, cursor));
    if (ui !== "frame") return { frameDisplayId: null, underCursor };
    const primary = this.deps.primaryDisplayId();
    const frame =
      displays[underCursor] ?? displays.find((display) => display.id === primary) ?? displays[0];
    return { frameDisplayId: frame!.id, underCursor };
  }

  private queriesFor(
    ui: OverlayUi,
    displays: Display[],
    frameDisplayId: number | null,
    intent: CaptureIntent,
  ): string[] {
    const displayIds = displays.map((display) => display.id);
    return displays.map((display, index) =>
      overlayQuery(ui, display, index + 1, displayIds, frameDisplayId, intent),
    );
  }

  /** What the spares of `displays` load: independent of mode, intent and frame (`overlaySpareQuery`). */
  private spareQueries(displays: Display[]): string[] {
    const displayIds = displays.map((display) => display.id);
    return displays.map((display, index) => overlaySpareQuery(display, index + 1, displayIds));
  }

  /**
   * Quit: cancel the warm-up, drop the spares and any open pick's windows for good (no
   * `beforeunload` round trip), and never load another. The windows this class creates after
   * the quit began are exactly what keeps Electron's quit waiting forever (NIW2-548).
   */
  dispose(): void {
    this.disposed = true;
    if (this.warmTimer) {
      clearTimeout(this.warmTimer);
      this.warmTimer = null;
    }
    const spares = this.spares;
    this.spares = null;
    this.destroySpares(spares);
    this.destroyAll();
  }

  private scheduleWarm(delayMs: number): void {
    if (this.disposed || !this.deps.warmup || this.warmTimer) return;
    this.warmTimer = setTimeout(() => {
      this.warmTimer = null;
      this.warm();
    }, delayMs);
  }

  private warm(): void {
    const warmup = this.deps.warmup;
    if (!warmup || this.session || this.spares) return;
    if (!warmup.canWarm()) {
      this.scheduleWarm(this.deps.warmRetryMs);
      return;
    }
    const next = warmup.next(this.lastIntent);
    if (!next || next.displays.length === 0) return;
    const queries = this.spareQueries(next.displays);
    this.spares = {
      key: queries.join("|"),
      entries: next.displays.map((display, index) => this.createOverlay(display, queries[index]!)),
    };
  }

  private destroySpares(spares: Spares | null): void {
    for (const { window } of spares?.entries ?? []) {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  /** A spare that broke (crash, failed load, closed): drop them all, a pick loads its own. */
  private dropSpareFor(entry: OverlayEntry): void {
    const spares = this.spares;
    if (!spares?.entries.includes(entry)) return;
    this.spares = null;
    this.destroySpares(spares);
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

  /** Push the list into the state every overlay renders. Ignored when no pick is open. */
  private setWindows(list: ListedWindow[]): void {
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
    // Window mode is off: no list is ever needed, so no osascript/powershell is spawned.
    if (!this.deps.enabledModes.includes("window")) return;
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
    if (session) this.lastIntent = this.intent;
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
    // The next pick's windows load once this one's shot or take is under way.
    this.scheduleWarm(this.deps.warmDelayMs);
  }

  /** One overlay window for `display`, loading `query`; shown once it paints and a pick is open. */
  private createOverlay(display: Display, query: string): OverlayEntry {
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

    const entry: OverlayEntry = { window, displayId: display.id, ready: false };
    window.once("ready-to-show", () => {
      entry.ready = true;
      // A spare waits hidden for its pick; one whose pick ended was destroyed with it.
      if (this.entries.includes(entry)) this.reveal(entry);
    });
    window.on("closed", () => {
      this.dropSpareFor(entry);
      this.forget(entry);
    });
    // A crashed renderer leaves its window open: invisible, screen-covering and eating
    // clicks, with no overlay left to press Esc in. Cancel and tear the session down.
    window.webContents.on("render-process-gone", () => {
      this.dropSpareFor(entry);
      if (this.entries.includes(entry)) this.destroyAll();
    });
    // A load that fails or a renderer that hangs leaves a window nobody can answer.
    window.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
      if (errorCode === ERR_ABORTED || isMainFrame === false) return;
      this.dropSpareFor(entry);
      if (this.entries.includes(entry)) this.destroyAll();
    });
    window.webContents.on("unresponsive", () => {
      this.dropSpareFor(entry);
      if (this.entries.includes(entry)) this.destroyAll();
    });
    // Esc from main, so cancelling does not depend on which renderer holds keyboard focus.
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "Escape") return;
      if (!this.entries.includes(entry)) return;
      event.preventDefault();
      this.answer({ kind: "cancelled" });
    });

    this.deps.loadRenderer(window, query);
    return entry;
  }

  /** Show a painted window of the open pick. */
  private reveal(entry: OverlayEntry): void {
    const { window, displayId } = entry;
    // Answered or destroyed before it painted: never show a stale overlay.
    if (window.isDestroyed() || !this.session?.settle) return;
    this.setSpaceBehavior(window, true);
    // The state first: a spare learns its mode, intent and frame display here, and it paints
    // nothing until it has them.
    this.sendState(window);
    // `show()` also makes the window key, so with several displays whichever overlay
    // painted LAST took the keyboard and Enter / ⌘C on the frame went nowhere. Only the
    // focus target is shown active; the others never take focus on their own.
    if (displayId === this.focusDisplayId) {
      window.show();
      window.focus();
    } else {
      window.showInactive();
    }
    if (this.intent === "record") markRecordTiming(`overlay shown on display ${displayId}`);
    const session = this.session;
    session.shown += 1;
    if (session.shown >= this.entries.length && session.watchdog) {
      clearTimeout(session.watchdog);
      session.watchdog = null;
    }
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
      intent: this.intent,
      hoverDisplayId: this.hoverDisplayId,
      frameDisplayId: this.frameDisplayId,
      windows: this.windows,
      // Window: where the pointer is now, so a picker can highlight under a still pointer.
      ...(this.windows !== null ? { cursor: this.deps.cursorPoint() } : {}),
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

  /** Make `displayId`'s overlay the key window (once; `force` re-focuses it anyway). */
  private focusOn(displayId: number, force = false): void {
    if (!force && this.focusDisplayId === displayId) return;
    this.focusDisplayId = displayId;
    this.liveEntries()
      .find((entry) => entry.displayId === displayId)
      ?.window.focus();
  }

  private ownsSender(event: SenderEvent): boolean {
    return this.liveEntries().some(({ window }) => window.webContents.id === event.sender.id);
  }

  private registerListeners(): void {
    // The renderer's listener is attached now: whatever state went out before it is resent.
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayStateRequest, (event) => {
      if (!this.session) return;
      const entry = this.liveEntries().find(
        ({ window }) => window.webContents.id === event.sender.id,
      );
      if (entry) this.sendState(entry.window);
    });

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
      // Window: each overlay highlights the window under the pointer on its own display, and
      // Enter / ⌘C act on that highlight, so the keyboard follows the pointer across displays.
      // Only a renderer's report about its own (shown) window moves the focus.
      if (this.mode === "window" && this.session.settle && next !== null) {
        if (next === this.displayOf(event)) this.focusOn(next);
      }
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
      // Enter lives in the window that now holds the frame: make it the key window.
      this.focusOn(displayId, true);
      this.broadcastState();
    });

    // The mode pill (or keys 1–3) on any overlay: every overlay re-renders in that mode.
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayMode, (event, payload) => {
      if (!this.session?.settle) return;
      const sender = this.displayOf(event);
      if (sender === null) return;
      const mode = (payload as { mode?: unknown } | undefined)?.mode;
      if (!isCaptureMode(mode) || !this.deps.enabledModes.includes(mode) || mode === this.mode) {
        return;
      }
      this.mode = mode;
      // The frame lives only in Frame; entering it puts it where the user asked from.
      this.frameDisplayId = mode === "frame" ? sender : null;
      if (mode === "frame") this.focusOn(sender, true);
      if (mode === "window") this.requestWindows();
      this.broadcastState();
    });

    // P / V or the switch on one overlay: every overlay confirms with the same intent, so a
    // click on another display never takes a screenshot after the user chose Record.
    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayIntent, (event, payload) => {
      if (!this.session?.settle || this.displayOf(event) === null) return;
      const intent = (payload as { intent?: unknown } | undefined)?.intent;
      if (!isCaptureIntent(intent) || intent === this.intent) return;
      this.intent = intent;
      this.broadcastState();
    });

    this.deps.ipc.on(IPC_CHANNELS.screenshotOverlayHiddenAck, (event) => {
      if (this.ownsSender(event)) this.ackFrom(event.sender.id);
    });

    // Failure 6: a display going away while the overlay is up cancels the whole pick,
    // and its window (now orphaned off-screen) goes with the rest.
    this.deps.screen.on("display-removed", (_event, display) => {
      // Spares were laid out for the old displays.
      this.refreshSpares();
      if (!this.session?.settle || !this.session.displayIds.has(display.id)) return;
      this.destroyAll(); // settles the pick with `cancelled`
    });
    this.deps.screen.on("display-added", () => this.refreshSpares());
    this.deps.screen.on("display-metrics-changed", () => this.refreshSpares());
  }
}
