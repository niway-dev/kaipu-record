import type { Display } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@shared/types/ipc";

const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = [];
const ipcListeners = new Map<
  string,
  (event: { sender: { id: number } }, payload?: unknown) => void
>();
const screenListeners = new Map<string, (event: unknown, display: Display) => void>();
let nextWebContentsId = 100;

class FakeWindow {
  private renderGone: (() => void) | null = null;
  private contentsListeners = new Map<string, (...args: never[]) => void>();
  webContents = {
    id: nextWebContentsId++,
    send: vi.fn(),
    on: vi.fn((event: string, callback: (...args: never[]) => void) => {
      if (event === "render-process-gone") this.renderGone = callback as () => void;
      this.contentsListeners.set(event, callback);
    }),
  };
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  show = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async (_path: string, _options?: { search: string }) => {});
  private destroyed = false;
  private readyToShow: (() => void) | null = null;
  private closed: (() => void) | null = null;
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.closed?.();
  });
  isDestroyed = () => this.destroyed;
  once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready-to-show") this.readyToShow = callback;
  });
  on = vi.fn((event: string, callback: () => void) => {
    if (event === "closed") this.closed = callback;
  });
  constructor(options: Record<string, unknown>) {
    created.push({ options, window: this });
  }
  paint(): void {
    this.readyToShow?.();
  }
  /** The renderer process dying: Electron keeps the window open and emits this. */
  crashRenderer(): void {
    this.renderGone?.();
  }
  /** Emit a `webContents` event (`did-fail-load`, `unresponsive`, `before-input-event`). */
  emitContents(event: string, ...args: unknown[]): void {
    (this.contentsListeners.get(event) as ((...a: unknown[]) => void) | undefined)?.(...args);
  }
  /** A `closed` event delivered (again, or late) without a fresh destroy. */
  emitClosed(): void {
    this.closed?.();
  }
  /** The renderer sending to main on `channel`. */
  send(channel: string, payload?: unknown): void {
    ipcListeners.get(channel)?.({ sender: { id: this.webContents.id } }, payload);
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  ipcMain: { on: (channel: string, listener: never) => ipcListeners.set(channel, listener) },
  screen: {
    on: (event: string, listener: never) => screenListeners.set(event, listener),
    getCursorScreenPoint: () => ({ x: 2000, y: 100 }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { CaptureOverlayWindows, HIDDEN_ACK_CAP_MS, OVERLAY_READY_TIMEOUT_MS } =
  await import("./capture-overlay-windows");

function display(id: number, x: number, scaleFactor = 2): Display {
  return {
    id,
    bounds: { x, y: 0, width: 1440, height: 900 },
    workArea: { x, y: 25, width: 1440, height: 875 },
    scaleFactor,
  } as Display;
}
const left = display(1, 0);
const right = display(2, 1440, 1);

function overlays(platform: NodeJS.Platform = "darwin") {
  return new CaptureOverlayWindows({ platform });
}

beforeEach(() => {
  created.length = 0;
  ipcListeners.clear();
  screenListeners.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CaptureOverlayWindows: creating the overlays", () => {
  it("opens one borderless, transparent sheet per display, covering its bounds", () => {
    void overlays("win32").pick("screen", [left, right]);

    expect(created).toHaveLength(2);
    const [first, second] = created;
    expect(first.options).toMatchObject({
      ...left.bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      alwaysOnTop: true,
      fullscreenable: false,
      focusable: true,
      acceptFirstMouse: true,
      webPreferences: { sandbox: false },
    });
    expect(String((first.options.webPreferences as { preload: string }).preload)).toMatch(
      /preload[/\\]index\.js$/,
    );
    expect(second.options).toMatchObject(right.bounds);
    for (const { window } of created) {
      expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    }
  });

  it("loads the overlay render target with everything the renderer needs in the query", () => {
    void overlays().pick("frame", [left, right]);

    expect(created[0].window.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer[/\\]index\.html$/),
      {
        search:
          "?window=capture-overlay&display=1&ui=frame&index=1&count=2" +
          "&bounds=0,0,1440,900&work=0,25,1440,875&ids=1,2",
      },
    );
    expect(created[1].window.loadFile.mock.calls[0][1]).toEqual({
      search:
        "?window=capture-overlay&display=2&ui=frame&index=2&count=2" +
        "&bounds=1440,0,1440,900&work=1440,25,1440,875&ids=1,2",
    });
  });

  it("writes negative origins as-is, for a display left of the primary", () => {
    void overlays().pick("screen", [display(3, -1920)]);

    expect(created[0].window.loadFile.mock.calls[0][1]).toEqual({
      search:
        "?window=capture-overlay&display=3&ui=screen&index=1&count=1" +
        "&bounds=-1920,0,1440,900&work=-1920,25,1440,875&ids=3",
    });
  });

  it("is a floating panel on macOS and a plain window on Windows", () => {
    void overlays("darwin").pick("area", [left]);
    void overlays("win32").pick("area", [left]);

    expect(created[0].options.type).toBe("panel");
    expect(created[1].options).not.toHaveProperty("type");
  });

  it("shows each overlay only once it has painted, focusing the one under the pointer", () => {
    void overlays("win32").pick("screen", [left, right]);
    const [first, second] = created.map(({ window }) => window);
    expect(first.show).not.toHaveBeenCalled();

    first.paint();
    second.paint();

    expect(first.show).toHaveBeenCalled();
    expect(second.show).toHaveBeenCalled();
    expect(first.focus).not.toHaveBeenCalled();
    expect(second.focus).toHaveBeenCalled(); // the pointer (2000, 100) is on the right display
  });

  it("answers cancelled without creating anything when there is no display", async () => {
    expect(await overlays().pick("screen", [])).toEqual({ kind: "cancelled" });
    expect(created).toHaveLength(0);
  });
});

describe("CaptureOverlayWindows: the open-only Space toggle", () => {
  it("on macOS joins every Space right before show and leaves them right after hide", async () => {
    const port = overlays("darwin");
    void port.pick("frame", [left]);
    const { window } = created[0];
    expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();

    window.paint();
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(window.setVisibleOnAllWorkspaces.mock.invocationCallOrder[0]).toBeLessThan(
      window.show.mock.invocationCallOrder[0],
    );

    window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });
    vi.useFakeTimers();
    const hidden = port.hideAll();
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(false, {
      visibleOnFullScreen: false,
      skipTransformProcessType: true,
    });
    expect(window.hide.mock.invocationCallOrder[0]).toBeLessThan(
      window.setVisibleOnAllWorkspaces.mock.invocationCallOrder[1],
    );
    await vi.advanceTimersByTimeAsync(HIDDEN_ACK_CAP_MS);
    await hidden;
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("never touches Spaces on Windows", async () => {
    const port = overlays("win32");
    void port.pick("frame", [left]);
    const { window } = created[0];
    window.paint();
    vi.useFakeTimers();
    const hidden = port.hideAll();
    await vi.advanceTimersByTimeAsync(HIDDEN_ACK_CAP_MS);
    await hidden;

    expect(window.show).toHaveBeenCalled();
    expect(window.hide).toHaveBeenCalled();
    expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
});

describe("CaptureOverlayWindows: answers", () => {
  it("resolves with the first answer from any overlay and ignores later ones", async () => {
    const port = overlays();
    const picked = port.pick("screen", [left, right]);
    const [first, second] = created.map(({ window }) => window);

    second.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 2 });
    first.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "cancelled" });

    expect(await picked).toEqual({ kind: "display", displayId: 2 });
  });

  it("keeps the windows up after answering, so the provider decides when they go", async () => {
    const port = overlays();
    const picked = port.pick("frame", [left]);
    const rect = { x: 10, y: 20, width: 300, height: 200 };
    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, {
      kind: "rect",
      displayId: 1,
      rect,
    });

    expect(await picked).toEqual({ kind: "rect", displayId: 1, rect });
    expect(created[0].window.destroy).not.toHaveBeenCalled();
    expect(created[0].window.hide).not.toHaveBeenCalled();
  });

  it("never shows an overlay that finishes painting after the pick was answered", async () => {
    const port = overlays();
    const picked = port.pick("screen", [left, right]);
    const [first, late] = created.map(({ window }) => window);
    first.paint();
    first.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });
    await picked;

    late.paint();

    expect(late.show).not.toHaveBeenCalled();
  });

  it("ignores malformed answers and answers from windows that are not overlays", async () => {
    const port = overlays();
    const picked = port.pick("frame", [left]);
    const answer = ipcListeners.get(IPC_CHANNELS.screenshotOverlayAnswer)!;

    answer({ sender: { id: 99_999 } }, { kind: "cancelled" }); // another window
    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 7 });
    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, {
      kind: "rect",
      displayId: 1,
      rect: { x: 0, y: 0, width: Number.NaN, height: 10 },
    });
    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });

    expect(await picked).toEqual({ kind: "display", displayId: 1 });
  });

  it("rebroadcasts hover to every overlay so only one highlights", () => {
    void overlays().pick("screen", [left, right]);
    const [first, second] = created.map(({ window }) => window);

    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 2 });

    for (const window of [first, second]) {
      expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.screenshotOverlayState, {
        hoverDisplayId: 2,
      });
    }
  });

  it("ignores a late 'left' from a display that is no longer the hovered one", () => {
    void overlays().pick("screen", [left, right]);
    const [first, second] = created.map(({ window }) => window);

    first.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 1 });
    // The pointer crosses to display 2; display 1's "left" arrives after 2's "entered".
    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 2 });
    first.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: null });

    const states = second.webContents.send.mock.calls
      .filter(([channel]) => channel === IPC_CHANNELS.screenshotOverlayState)
      .map(([, state]) => state);
    expect(states).toEqual([{ hoverDisplayId: 1 }, { hoverDisplayId: 2 }]);

    // The hovered display's own window can still clear it.
    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: null });
    expect(second.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.screenshotOverlayState, {
      hoverDisplayId: null,
    });
  });

  it("a second pick while one is up answers cancelled and leaves the first alone", async () => {
    const port = overlays();
    const first = port.pick("screen", [left, right]);

    expect(await port.pick("frame", [left])).toEqual({ kind: "cancelled" });
    expect(created).toHaveLength(2);
    expect(created.some(({ window }) => window.destroy.mock.calls.length > 0)).toBe(false);

    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });
    expect(await first).toEqual({ kind: "display", displayId: 1 });
  });

  it("allows a new pick once the previous session was destroyed", async () => {
    const port = overlays();
    void port.pick("screen", [left]);
    port.destroyAll();

    void port.pick("frame", [left]);
    expect(created).toHaveLength(2);
  });
});

describe("CaptureOverlayWindows: failures", () => {
  it("cancels and destroys every overlay when a display disconnects mid-pick", async () => {
    const port = overlays();
    const picked = port.pick("screen", [left, right]);

    screenListeners.get("display-removed")!({}, right);

    expect(await picked).toEqual({ kind: "cancelled" });
    for (const { window } of created) expect(window.destroy).toHaveBeenCalled();
  });

  it("cancels when an overlay window closes on its own (OS close)", async () => {
    const port = overlays();
    const picked = port.pick("screen", [left, right]);

    created[1].window.destroy();

    expect(await picked).toEqual({ kind: "cancelled" });
  });

  it("cancels and destroys every overlay when one renderer crashes", async () => {
    const port = overlays();
    const picked = port.pick("frame", [left, right]);

    created[0].window.crashRenderer(); // the window stays open; only the renderer is gone

    expect(await picked).toEqual({ kind: "cancelled" });
    for (const { window } of created) expect(window.isDestroyed()).toBe(true);
  });

  it("a crash in an overlay from a finished session leaves the next pick alone", async () => {
    const port = overlays();
    void port.pick("screen", [left]);
    const stale = created[0].window;
    port.destroyAll();
    const next = port.pick("screen", [left]);
    const current = created[1].window;

    stale.crashRenderer();
    stale.emitClosed(); // a late `closed` from the destroyed window
    current.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });

    expect(await next).toEqual({ kind: "display", displayId: 1 });
    expect(current.isDestroyed()).toBe(false);
  });
});

describe("CaptureOverlayWindows: stuck overlays", () => {
  it("cancels and destroys when an overlay has not painted within the timeout", async () => {
    vi.useFakeTimers();
    const port = overlays();
    const picked = port.pick("frame", [left, right]);
    created[0].window.paint(); // one of two painted; the other never does

    vi.advanceTimersByTime(OVERLAY_READY_TIMEOUT_MS - 1);
    expect(created[0].window.isDestroyed()).toBe(false);
    vi.advanceTimersByTime(1);

    expect(await picked).toEqual({ kind: "cancelled" });
    for (const { window } of created) expect(window.isDestroyed()).toBe(true);
  });

  it("honours an injected timeout", async () => {
    vi.useFakeTimers();
    const picked = new CaptureOverlayWindows({ platform: "darwin", readyTimeoutMs: 500 }).pick(
      "area",
      [left],
    );
    vi.advanceTimersByTime(500);
    expect(await picked).toEqual({ kind: "cancelled" });
  });

  it("stops watching once every overlay is shown", () => {
    vi.useFakeTimers();
    void overlays().pick("frame", [left, right]);
    created[0].window.paint();
    created[1].window.paint();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(OVERLAY_READY_TIMEOUT_MS * 2);
    for (const { window } of created) expect(window.isDestroyed()).toBe(false);
  });

  it("clears the watchdog when the session is destroyed", () => {
    vi.useFakeTimers();
    const port = overlays();
    void port.pick("frame", [left]);
    expect(vi.getTimerCount()).toBe(1);
    port.destroyAll();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a watchdog from a finished session leaves the next pick alone", async () => {
    vi.useFakeTimers();
    const port = overlays();
    void port.pick("screen", [left]);
    port.destroyAll();
    const next = port.pick("screen", [left]);
    created[1].window.paint();
    vi.advanceTimersByTime(OVERLAY_READY_TIMEOUT_MS * 2);
    created[1].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });
    expect(await next).toEqual({ kind: "display", displayId: 1 });
  });

  it("cancels and destroys every overlay when a main-frame load fails", async () => {
    const port = overlays();
    const picked = port.pick("frame", [left, right]);

    created[1].window.emitContents("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "x", true);

    expect(await picked).toEqual({ kind: "cancelled" });
    for (const { window } of created) expect(window.isDestroyed()).toBe(true);
  });

  it("ignores an aborted navigation and a sub-frame load failure", () => {
    void overlays().pick("frame", [left]);
    created[0].window.emitContents("did-fail-load", {}, -3, "ERR_ABORTED", "x", true);
    created[0].window.emitContents("did-fail-load", {}, -105, "ERR_X", "x", false);
    expect(created[0].window.isDestroyed()).toBe(false);
  });

  it("cancels and destroys every overlay when a renderer becomes unresponsive", async () => {
    const port = overlays();
    const picked = port.pick("screen", [left, right]);

    created[0].window.emitContents("unresponsive");

    expect(await picked).toEqual({ kind: "cancelled" });
    for (const { window } of created) expect(window.isDestroyed()).toBe(true);
  });
});

describe("CaptureOverlayWindows: Escape handled by main", () => {
  const input = (key: string, type = "keyDown") => ({ type, key });

  it("answers cancelled on Escape without the renderer, keeping the windows for the cleanup", async () => {
    const port = overlays();
    const picked = port.pick("frame", [left, right]);
    const preventDefault = vi.fn();

    created[1].window.emitContents("before-input-event", { preventDefault }, input("Escape"));

    expect(await picked).toEqual({ kind: "cancelled" });
    expect(preventDefault).toHaveBeenCalled();
    port.destroyAll();
    for (const { window } of created) expect(window.isDestroyed()).toBe(true);
  });

  it("ignores other keys and key releases", () => {
    const port = overlays();
    let settled = false;
    void port.pick("frame", [left]).then(() => (settled = true));
    const event = { preventDefault: vi.fn() };

    created[0].window.emitContents("before-input-event", event, input("Enter"));
    created[0].window.emitContents("before-input-event", event, input("Escape", "keyUp"));

    return Promise.resolve().then(() => {
      expect(settled).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  it("an Escape from a finished session's window leaves the next pick alone", async () => {
    const port = overlays();
    void port.pick("screen", [left]);
    const stale = created[0].window;
    port.destroyAll();
    const next = port.pick("screen", [left]);

    stale.emitContents("before-input-event", { preventDefault: vi.fn() }, input("Escape"));
    created[1].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });

    expect(await next).toEqual({ kind: "display", displayId: 1 });
  });
});

describe("CaptureOverlayWindows: hideAll and destroyAll", () => {
  async function answered(platform: NodeJS.Platform = "darwin") {
    const port = overlays(platform);
    const picked = port.pick("screen", [left, right]);
    for (const { window } of created) window.paint();
    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });
    await picked;
    return { port, windows: created.map(({ window }) => window) };
  }

  it("resolves once every overlay acks its frame after hiding", async () => {
    const { port, windows } = await answered();
    vi.useFakeTimers();
    let done = false;
    const hidden = port.hideAll().then(() => {
      done = true;
    });

    for (const window of windows) expect(window.hide).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0); // the setTimeout(0) tick
    for (const window of windows) {
      expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.screenshotOverlayHiddenAck);
    }

    windows[0].send(IPC_CHANNELS.screenshotOverlayHiddenAck);
    await vi.advanceTimersByTimeAsync(10); // flush; still well under the cap
    expect(done).toBe(false); // one overlay still owes its frame

    windows[1].send(IPC_CHANNELS.screenshotOverlayHiddenAck);
    await hidden;
    expect(done).toBe(true);
  });

  it("does not wait past the cap when an overlay never acks", async () => {
    const { port, windows } = await answered();
    vi.useFakeTimers();
    let done = false;
    const hidden = port.hideAll().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    windows[0].send(IPC_CHANNELS.screenshotOverlayHiddenAck);

    await vi.advanceTimersByTimeAsync(HIDDEN_ACK_CAP_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await hidden;
    expect(done).toBe(true);
  });

  it("does not start a second wait when called twice", async () => {
    const { port, windows } = await answered();
    vi.useFakeTimers();
    const first = port.hideAll();
    const second = port.hideAll();
    await vi.advanceTimersByTimeAsync(0);
    for (const window of windows) window.send(IPC_CHANNELS.screenshotOverlayHiddenAck);
    await Promise.all([first, second]);

    for (const window of windows) expect(window.hide).toHaveBeenCalledTimes(1);
  });

  it("destroyAll destroys every overlay, and is safe to call again", async () => {
    const { port, windows } = await answered();

    port.destroyAll();
    port.destroyAll();

    for (const window of windows) expect(window.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroyAll during a pick settles it as cancelled", async () => {
    const port = overlays();
    const picked = port.pick("frame", [left]);

    port.destroyAll();

    expect(await picked).toEqual({ kind: "cancelled" });
  });
});
