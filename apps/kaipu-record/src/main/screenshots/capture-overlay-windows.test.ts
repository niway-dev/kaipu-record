import type { Display } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { CAPTURE_MODES } from "@shared/types/screenshot-capture";

const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = [];
const ipcListeners = new Map<
  string,
  (event: { sender: { id: number } }, payload?: unknown) => void
>();
const screenListeners = new Map<string, (event: unknown, display: Display) => void>();
let nextWebContentsId = 100;
/** The window holding keyboard focus, as the OS sees it: Electron's `show()` takes it, `showInactive()` does not. */
let keyWindowId: number | null = null;

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
  show = vi.fn(() => {
    keyWindowId = this.webContents.id;
  });
  showInactive = vi.fn();
  hide = vi.fn();
  focus = vi.fn(() => {
    keyWindowId = this.webContents.id;
  });
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
    getPrimaryDisplay: () => ({ id: 1 }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { CaptureOverlayWindows, HIDDEN_ACK_CAP_MS, OVERLAY_READY_TIMEOUT_MS } =
  await import("./capture-overlay-windows");
const { beginRecordTiming, endRecordTiming } = await import("../recording/record-timing");

function display(id: number, x: number, scaleFactor = 2): Display {
  return {
    id,
    bounds: { x, y: 0, width: 1440, height: 900 },
    workArea: { x, y: 25, width: 1440, height: 875 },
    scaleFactor,
  } as Display;
}
const left = display(1, 0);
/** Let pending promise callbacks (the window lister's answer) run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const right = display(2, 1440, 1);

function overlays(platform: NodeJS.Platform = "darwin") {
  return new CaptureOverlayWindows({ platform, enabledModes: CAPTURE_MODES });
}

beforeEach(() => {
  created.length = 0;
  keyWindowId = null;
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
          "&bounds=0,0,1440,900&work=0,25,1440,875&ids=1,2&frame=2",
      },
    );
    expect(created[1].window.loadFile.mock.calls[0][1]).toEqual({
      search:
        "?window=capture-overlay&display=2&ui=frame&index=2&count=2" +
        "&bounds=1440,0,1440,900&work=1440,25,1440,875&ids=1,2&frame=2",
    });
  });

  it("tells the renderer it was opened to record, and says nothing for a screenshot", () => {
    void overlays().pick("frame", [left], "record");
    // The scale feeds the record intent's size readout, in device pixels.
    expect(String(created[0].window.loadFile.mock.calls[0]?.[1]?.search)).toContain(
      "&intent=record&scale=2",
    );

    created.length = 0;
    void overlays().pick("frame", [left]);
    expect(String(created[0].window.loadFile.mock.calls[0]?.[1]?.search)).not.toContain("intent");
    expect(String(created[0].window.loadFile.mock.calls[0]?.[1]?.search)).not.toContain("scale");
  });

  it("writes negative origins as-is, for a display left of the primary", () => {
    void overlays().pick("screen", [display(3, -1920)]);

    expect(created[0].window.loadFile.mock.calls[0][1]).toEqual({
      search:
        "?window=capture-overlay&display=3&ui=screen&index=1&count=1" +
        "&bounds=-1920,0,1440,900&work=-1920,25,1440,875&ids=3",
    });
  });

  it("marks the built-in display in the query, for the Screen card's label", () => {
    void overlays().pick("screen", [{ ...left, internal: true } as Display]);

    expect(created[0].window.loadFile.mock.calls[0][1]).toEqual({
      search:
        "?window=capture-overlay&display=1&ui=screen&index=1&count=1" +
        "&bounds=0,0,1440,900&work=0,25,1440,875&ids=1&internal=1",
    });
  });

  it("is a floating panel on macOS and a plain window on Windows", () => {
    void overlays("darwin").pick("screen", [left]);
    void overlays("win32").pick("screen", [left]);

    expect(created[0].options.type).toBe("panel");
    expect(created[1].options).not.toHaveProperty("type");
  });

  it("shows each overlay only once it has painted, focusing the one under the pointer", () => {
    void overlays("win32").pick("screen", [left, right]);
    const [first, second] = created.map(({ window }) => window);
    expect(first.show).not.toHaveBeenCalled();
    expect(first.showInactive).not.toHaveBeenCalled();

    first.paint();
    second.paint();

    expect(first.showInactive).toHaveBeenCalled();
    expect(second.show).toHaveBeenCalled();
    expect(first.focus).not.toHaveBeenCalled();
    expect(second.focus).toHaveBeenCalled(); // the pointer (2000, 100) is on the right display
  });

  // Three displays paint in whatever order their renderers load. `show()` makes a window
  // key, so a display that paints after the focused one used to take the keyboard, and
  // Enter / ⌘C on the frame went nowhere.
  it("keeps keyboard focus on the focused overlay whatever order the others paint in", () => {
    const third = display(3, 2880);
    for (const order of [
      [1, 0, 2],
      [0, 1, 2],
      [2, 1, 0],
    ]) {
      created.length = 0;
      keyWindowId = null;
      void overlays("darwin").pick("frame", [left, right, third]);
      const windows = created.map(({ window }) => window);
      for (const index of order) windows[index].paint();

      // The pointer (2000, 100) is on the right display, so the frame and the keyboard are there.
      expect(keyWindowId).toBe(windows[1].webContents.id);
    }
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

    expect(await picked).toEqual({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 2,
    });
  });

  describe("answer validation", () => {
    const rect = { x: 10, y: 20, width: 300, height: 200 };
    const answerWith = async (ui: "frame" | "window" | "screen", payload: unknown) => {
      const port = overlays();
      const picked = port.pick(ui, [left]);
      created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, payload);
      // A refused payload leaves the pick open; Esc settles it so the test can look.
      created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "cancelled" });
      return picked;
    };

    it("carries the mode and the action the overlay answered with", async () => {
      expect(
        await answerWith("frame", {
          kind: "rect",
          mode: "frame",
          action: "copy",
          displayId: 1,
          rect,
        }),
      ).toEqual({ kind: "rect", mode: "frame", action: "copy", displayId: 1, rect });
    });

    it.each(["record", "select"] as const)(
      "accepts the %s action, which chooses a recording target",
      async (action) => {
        expect(
          await answerWith("frame", { kind: "rect", mode: "frame", action, displayId: 1, rect }),
        ).toEqual({ kind: "rect", mode: "frame", action, displayId: 1, rect });
      },
    );

    it("keeps the ratio a record answer was locked to", async () => {
      expect(
        await answerWith("frame", {
          kind: "rect",
          mode: "frame",
          action: "record",
          displayId: 1,
          rect,
          ratio: "9:16",
        }),
      ).toEqual({
        kind: "rect",
        mode: "frame",
        action: "record",
        displayId: 1,
        rect,
        ratio: "9:16",
      });
    });

    it("drops a ratio that names no chip", async () => {
      expect(
        await answerWith("frame", {
          kind: "rect",
          mode: "frame",
          action: "record",
          displayId: 1,
          rect,
          ratio: "4:3",
        }),
      ).toEqual({ kind: "rect", mode: "frame", action: "record", displayId: 1, rect });
    });

    it("accepts a window answer by id, with main's own rect and whole size, not the renderer's", async () => {
      const fullSize = { width: 900, height: 400 };
      const port = new CaptureOverlayWindows({
        enabledModes: CAPTURE_MODES,
        platform: "darwin",
        windowLister: {
          list: async () => [
            { id: "4242", title: "Editor", ownerName: "Kaipu", displayId: 1, rect, fullSize },
          ],
        },
      });
      const picked = port.pick("window", [left]);
      await flush();
      created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, {
        kind: "window",
        mode: "window",
        action: "capture",
        displayId: 1,
        windowId: "4242",
        // A renderer that drifted (or lies) about the geometry: main keeps its own list's.
        rect: { x: 0, y: 0, width: 5000, height: 5000 },
      });
      expect(await picked).toEqual({
        kind: "window",
        mode: "window",
        action: "capture",
        displayId: 1,
        windowId: "4242",
        rect,
        fullSize,
      });
    });

    it.each([
      ["a window answer without an id", { kind: "window", displayId: 1, windowId: "", rect }],
      ["a rect answer claiming another mode", { kind: "rect", mode: "screen", displayId: 1, rect }],
      ["an unknown action", { kind: "display", displayId: 1, action: "share" }],
    ])("refuses %s", async (_name, payload) => {
      expect(await answerWith("frame", payload)).toEqual({ kind: "cancelled" });
    });
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

    expect(await picked).toEqual({
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 1,
      rect,
    });
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

    expect(await picked).toEqual({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 1,
    });
  });

  it("rebroadcasts hover to every overlay so only one highlights", () => {
    void overlays().pick("screen", [left, right]);
    const [first, second] = created.map(({ window }) => window);

    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 2 });

    for (const window of [first, second]) {
      expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.screenshotOverlayState, {
        mode: "screen",
        intent: "capture",
        hoverDisplayId: 2,
        frameDisplayId: null,
        windows: null,
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
    expect(states).toEqual([
      { mode: "screen", intent: "capture", hoverDisplayId: 1, frameDisplayId: null, windows: null },
      { mode: "screen", intent: "capture", hoverDisplayId: 2, frameDisplayId: null, windows: null },
    ]);

    // The hovered display's own window can still clear it.
    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: null });
    expect(second.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.screenshotOverlayState, {
      mode: "screen",
      intent: "capture",
      hoverDisplayId: null,
      frameDisplayId: null,
      windows: null,
    });
  });

  describe("Frame display (one frame at a time)", () => {
    const states = (window: FakeWindow) =>
      window.webContents.send.mock.calls
        .filter(([channel]) => channel === IPC_CHANNELS.screenshotOverlayState)
        .map(([, state]) => state);
    const pickFrame = (cursor: { x: number; y: number }, primaryDisplayId: number | null = 1) => {
      const port = new CaptureOverlayWindows({
        enabledModes: CAPTURE_MODES,
        platform: "darwin",
        cursorPoint: () => cursor,
        primaryDisplayId: () => primaryDisplayId,
      });
      void port.pick("frame", [left, right]);
      const [first, second] = created.map(({ window }) => window);
      first.paint();
      second.paint();
      return { first, second };
    };

    it("starts on the display under the cursor and sends it as each window is shown", () => {
      const { first, second } = pickFrame({ x: 1500, y: 100 });

      expect(states(first)).toEqual([
        {
          mode: "frame",
          intent: "capture",
          hoverDisplayId: null,
          frameDisplayId: 2,
          windows: null,
        },
      ]);
      expect(states(second)).toEqual([
        {
          mode: "frame",
          intent: "capture",
          hoverDisplayId: null,
          frameDisplayId: 2,
          windows: null,
        },
      ]);
    });

    it("falls back to the primary display when the cursor is on none of them", () => {
      const { first } = pickFrame({ x: 5000, y: 5000 }, 2);

      expect(states(first)).toEqual([
        {
          mode: "frame",
          intent: "capture",
          hoverDisplayId: null,
          frameDisplayId: 2,
          windows: null,
        },
      ]);
    });

    it("focuses the frame display's window, not the first one, when the cursor is on none", () => {
      const { first, second } = pickFrame({ x: 5000, y: 5000 }, 2);

      expect(first.focus).not.toHaveBeenCalled();
      expect(second.focus).toHaveBeenCalledOnce();
    });

    it("falls back to the first picked display when the primary is not picked", () => {
      const { first, second } = pickFrame({ x: 5000, y: 5000 }, 99);

      expect(states(first)).toEqual([
        {
          mode: "frame",
          intent: "capture",
          hoverDisplayId: null,
          frameDisplayId: 1,
          windows: null,
        },
      ]);
      expect(first.focus).toHaveBeenCalledOnce();
      expect(second.focus).not.toHaveBeenCalled();
    });

    it("focuses the new window when the frame moves", () => {
      const { first, second } = pickFrame({ x: 100, y: 100 });
      expect(first.focus).toHaveBeenCalledOnce();

      second.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: 2 });

      expect(second.focus).toHaveBeenCalledOnce();
      first.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: 1 });
      expect(first.focus).toHaveBeenCalledTimes(2);
    });

    it("moves the frame and rebroadcasts when a valid overlay asks", () => {
      const { first, second } = pickFrame({ x: 100, y: 100 });
      expect(states(first).at(-1)?.frameDisplayId).toBe(1);

      second.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: 2 });

      for (const window of [first, second]) {
        expect(window.webContents.send).toHaveBeenLastCalledWith(
          IPC_CHANNELS.screenshotOverlayState,
          {
            mode: "frame",
            intent: "capture",
            hoverDisplayId: null,
            frameDisplayId: 2,
            windows: null,
          },
        );
      }
    });

    it("ignores an unknown display id, a malformed payload and a foreign sender", () => {
      const { first, second } = pickFrame({ x: 100, y: 100 });
      const before = states(first).length;

      second.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: 99 });
      second.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: "2" });
      second.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, undefined);
      ipcListeners.get(IPC_CHANNELS.screenshotOverlayFrameDisplay)?.(
        { sender: { id: 99999 } },
        { displayId: 2 },
      );
      // Already the frame display: nothing new to say.
      first.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: 1 });

      expect(states(first)).toHaveLength(before);
    });

    it("broadcasts frameDisplayId null for a non-frame pick, and ignores a move request", () => {
      void overlays().pick("screen", [left, right]);
      const [first, second] = created.map(({ window }) => window);
      first.paint();

      expect(states(first)).toEqual([
        {
          mode: "screen",
          intent: "capture",
          hoverDisplayId: null,
          frameDisplayId: null,
          windows: null,
        },
      ]);
      second.send(IPC_CHANNELS.screenshotOverlayFrameDisplay, { displayId: 2 });
      expect(states(first)).toHaveLength(1);
    });
  });

  it("a second pick while one is up answers cancelled and leaves the first alone", async () => {
    const port = overlays();
    const first = port.pick("screen", [left, right]);

    expect(await port.pick("frame", [left])).toEqual({ kind: "cancelled" });
    expect(created).toHaveLength(2);
    expect(created.some(({ window }) => window.destroy.mock.calls.length > 0)).toBe(false);

    created[0].window.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "display", displayId: 1 });
    expect(await first).toEqual({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 1,
    });
  });

  it("allows a new pick once the previous session was destroyed", async () => {
    const port = overlays();
    void port.pick("screen", [left]);
    port.destroyAll();

    void port.pick("frame", [left]);
    expect(created).toHaveLength(2);
  });
});

describe("CaptureOverlayWindows: switching mode inside the overlay", () => {
  const rect = { x: 10, y: 20, width: 300, height: 200 };
  const editor = {
    id: "4242",
    title: "Editor",
    ownerName: "Kaipu",
    displayId: 1,
    rect,
    fullSize: { width: rect.width, height: rect.height },
  };
  const states = (window: FakeWindow) =>
    window.webContents.send.mock.calls
      .filter(([channel]) => channel === IPC_CHANNELS.screenshotOverlayState)
      .map(([, state]) => state as Record<string, unknown>);

  function pickWith(
    ui: "frame" | "window" | "screen",
    lister: { list: () => Promise<unknown[]> } = { list: async () => [] },
  ) {
    const list = vi.fn(lister.list);
    const port = new CaptureOverlayWindows({
      enabledModes: CAPTURE_MODES,
      platform: "darwin",
      cursorPoint: () => ({ x: 100, y: 100 }),
      windowLister: { list } as never,
    });
    const picked = port.pick(ui, [left, right]);
    const [first, second] = created.map(({ window }) => window);
    first.paint();
    second.paint();
    return { port, picked, first, second, list };
  }

  it("ignores a mode switch from a window that is not an overlay", () => {
    const { first } = pickWith("frame");
    const before = states(first).length;

    ipcListeners.get(IPC_CHANNELS.screenshotOverlayMode)?.(
      { sender: { id: 99_999 } },
      { mode: "screen" },
    );

    expect(states(first)).toHaveLength(before);
  });

  it("ignores an unknown mode and a malformed payload", () => {
    const { first, second } = pickWith("frame");
    const before = states(first).length;

    second.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "area" });
    second.send(IPC_CHANNELS.screenshotOverlayMode, undefined);
    second.send(IPC_CHANNELS.screenshotOverlayMode, "screen");

    expect(states(first)).toHaveLength(before);
  });

  it("rebroadcasts the state with the new mode to every overlay", () => {
    const { first, second } = pickWith("frame");

    second.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "screen" });

    for (const window of [first, second]) {
      expect(states(window).at(-1)).toEqual({
        mode: "screen",
        intent: "capture",
        hoverDisplayId: null,
        frameDisplayId: null,
        windows: null,
      });
    }
  });

  it("rebroadcasts a Capture | Record switch to every overlay, and ignores junk", () => {
    const { first, second } = pickWith("screen");

    second.send(IPC_CHANNELS.screenshotOverlayIntent, { intent: "record" });
    for (const window of [first, second]) {
      expect(states(window).at(-1)).toMatchObject({ mode: "screen", intent: "record" });
    }
    const count = states(first).length;
    first.send(IPC_CHANNELS.screenshotOverlayIntent, { intent: "film" });
    first.send(IPC_CHANNELS.screenshotOverlayIntent, { intent: "record" });
    expect(states(first)).toHaveLength(count);
  });

  it("entering Frame puts the frame on the display that asked, and focuses it", () => {
    const { first, second } = pickWith("screen");

    second.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "frame" });

    expect(states(first).at(-1)).toMatchObject({ mode: "frame", frameDisplayId: 2 });
    expect(second.focus).toHaveBeenCalled();
  });

  it("lists the windows once, the first time Window is entered, and broadcasts them", async () => {
    const { first, second, list } = pickWith("frame", { list: async () => [editor] });
    expect(list).not.toHaveBeenCalled();

    first.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "window" });
    expect(states(second).at(-1)).toMatchObject({ mode: "window", windows: null });
    await flush();

    for (const window of [first, second]) {
      expect(states(window).at(-1)).toEqual({
        mode: "window",
        intent: "capture",
        hoverDisplayId: null,
        frameDisplayId: null,
        windows: [editor],
        cursor: { x: 100, y: 100 },
      });
    }
    first.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "screen" });
    first.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "window" });
    expect(list).toHaveBeenCalledOnce();
    expect(states(first).at(-1)).toMatchObject({ mode: "window", windows: [editor] });
  });

  it("Windows: starts the (slow) PowerShell listing when the pick opens, in any mode", async () => {
    const list = vi.fn(async () => [editor]);
    const port = new CaptureOverlayWindows({
      enabledModes: CAPTURE_MODES,
      platform: "win32",
      cursorPoint: () => ({ x: 100, y: 100 }),
      windowLister: { list } as never,
    });
    void port.pick("frame", [left, right]);
    expect(list).toHaveBeenCalledOnce();
    created[0].window.paint();
    await flush();
    created[0].window.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "window" });
    expect(list).toHaveBeenCalledOnce();
    const last = created[1].window.webContents.send.mock.calls
      .filter(([channel]) => channel === IPC_CHANNELS.screenshotOverlayState)
      .at(-1)?.[1];
    expect(last).toMatchObject({ mode: "window", windows: [editor] });
  });

  it("macOS: waits for Window before listing (osascript answers in ~50 ms)", () => {
    const { list } = pickWith("frame", { list: async () => [editor] });
    expect(list).not.toHaveBeenCalled();
  });

  it("starts listing at once when the pick opens in Window", async () => {
    const { first, list } = pickWith("window", { list: async () => [editor] });
    expect(list).toHaveBeenCalledOnce();
    await flush();
    expect(states(first).at(-1)).toMatchObject({ mode: "window", windows: [editor] });
  });

  it("a lister that rejects answers an empty list, not a stuck overlay", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { first } = pickWith("window", {
      list: async () => {
        throw new Error("osascript missing");
      },
    });
    await flush();
    expect(states(first).at(-1)).toMatchObject({ mode: "window", windows: [] });
  });

  it("a list that lands after the pick ended is dropped", async () => {
    let resolveList: (list: unknown[]) => void = () => {};
    const { port, first } = pickWith("window", {
      list: () => new Promise((resolve) => (resolveList = resolve)),
    });
    port.destroyAll();
    const sentBefore = first.webContents.send.mock.calls.length;

    resolveList([editor]);
    await flush();

    expect(first.webContents.send.mock.calls).toHaveLength(sentBefore);
  });

  it("Window: the pointer entering another display moves the keyboard to that overlay", async () => {
    const { first, second } = pickWith("window", { list: async () => [editor] });
    await flush();
    // The pick opened with the pointer on the left display (cursorPoint 100, 100).
    expect(first.focus).toHaveBeenCalled();
    expect(second.focus).not.toHaveBeenCalled();

    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 2 });

    // Enter and ⌘C act on the highlight of the overlay the pointer is on.
    expect(second.focus).toHaveBeenCalledOnce();
    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 2 });
    expect(second.focus).toHaveBeenCalledOnce();
  });

  it("Screen: hovering another display does not move the keyboard (Enter follows main's hover)", () => {
    const { second } = pickWith("screen");
    second.send(IPC_CHANNELS.screenshotOverlayHover, { displayId: 2 });
    expect(second.focus).not.toHaveBeenCalled();
  });

  it("broadcasts the pointer position once the window list has landed", async () => {
    const { first } = pickWith("window", { list: async () => [editor] });
    await flush();
    expect(states(first).at(-1)).toMatchObject({ windows: [editor], cursor: { x: 100, y: 100 } });
  });

  it("refuses a window answer for a display that does not hold that window", async () => {
    const { picked, second } = pickWith("window", { list: async () => [editor] });
    await flush();
    const answer = { kind: "window", mode: "window", action: "capture", windowId: "4242", rect };

    second.send(IPC_CHANNELS.screenshotOverlayAnswer, { ...answer, displayId: 2 });
    second.send(IPC_CHANNELS.screenshotOverlayAnswer, { ...answer, displayId: 1, windowId: "7" });
    second.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "cancelled" });

    expect(await picked).toEqual({ kind: "cancelled" });
  });

  it("refuses a window answer before the list has arrived", async () => {
    const { picked, first } = pickWith("window", { list: () => new Promise(() => {}) });

    first.send(IPC_CHANNELS.screenshotOverlayAnswer, {
      kind: "window",
      mode: "window",
      displayId: 1,
      windowId: "4242",
      rect,
    });
    first.send(IPC_CHANNELS.screenshotOverlayAnswer, { kind: "cancelled" });

    expect(await picked).toEqual({ kind: "cancelled" });
  });

  it("a new pick starts with the requested mode and no windows", async () => {
    const { port, first } = pickWith("frame", { list: async () => [editor] });
    first.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "window" });
    await flush();
    port.destroyAll();
    created.length = 0;

    void port.pick("screen", [left]);
    created[0].window.paint();

    expect(states(created[0].window)).toEqual([
      {
        mode: "screen",
        intent: "capture",
        hoverDisplayId: null,
        frameDisplayId: null,
        windows: null,
      },
    ]);
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

    expect(await next).toEqual({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 1,
    });
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
      "screen",
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
    expect(await next).toEqual({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 1,
    });
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

    expect(await next).toEqual({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 1,
    });
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

describe("CaptureOverlayWindows: Window mode disabled (the flag as shipped)", () => {
  function pickDefault(platform: NodeJS.Platform, ui: "frame" | "window" | "screen" = "frame") {
    const list = vi.fn(async () => []);
    const port = new CaptureOverlayWindows({
      platform,
      cursorPoint: () => ({ x: 100, y: 100 }),
      windowLister: { list } as never,
    });
    void port.pick(ui, [left, right]);
    const [first, second] = created.map(({ window }) => window);
    first.paint();
    second.paint();
    return { first, second, list };
  }
  const modes = (window: FakeWindow) =>
    window.webContents.send.mock.calls
      .filter(([channel]) => channel === IPC_CHANNELS.screenshotOverlayState)
      .map(([, state]) => (state as { mode: string }).mode);

  it("ignores a window mode switch and never starts the lister", async () => {
    const { first, second, list } = pickDefault("darwin");
    first.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "window" });
    await flush();

    expect(list).not.toHaveBeenCalled();
    expect(modes(first)).not.toContain("window");
    expect(modes(second)).not.toContain("window");
    // Screen still switches.
    first.send(IPC_CHANNELS.screenshotOverlayMode, { mode: "screen" });
    expect(modes(second).at(-1)).toBe("screen");
  });

  it("does not start the (otherwise eager) Windows lister either", async () => {
    const { list } = pickDefault("win32");
    await flush();
    expect(list).not.toHaveBeenCalled();
  });

  it("opens in Frame when asked for Window", () => {
    const { first, list } = pickDefault("darwin", "window");
    expect(modes(first).at(-1)).toBe("frame");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("CaptureOverlayWindows: the next pick's windows load hidden (warm-up)", () => {
  function warmed(
    options: {
      next?: { ui: "frame" | "screen"; intent: "record" | "capture" } | null;
      canWarm?: () => boolean;
    } = {},
  ) {
    const next = vi.fn((_lastIntent: unknown) =>
      options.next === null
        ? null
        : {
            ...(options.next ?? { ui: "frame" as const, intent: "record" as const }),
            displays: [left, right],
          },
    );
    const port = new CaptureOverlayWindows({
      platform: "darwin",
      enabledModes: CAPTURE_MODES,
      warmup: { next, canWarm: options.canWarm ?? (() => true) },
      warmDelayMs: 100,
      warmRetryMs: 500,
    });
    return { port, next };
  }

  it("loads one hidden window per display and never shows it before a pick", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);

    expect(created).toHaveLength(2);
    for (const { window } of created) window.paint();
    for (const { window } of created) {
      expect(window.show).not.toHaveBeenCalled();
      expect(window.showInactive).not.toHaveBeenCalled();
      // Joining every Space happens only when shown (ADR 0029, the open-only toggle).
      expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    }
  });

  it("a pick that matches shows the painted spares at once instead of loading new windows", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const [first, second] = created.map(({ window }) => window);
    first!.paint();

    void port.pick("frame", [left, right], "record");

    expect(created).toHaveLength(2);
    // The frame (and the keyboard) is on the display under the pointer, still loading.
    expect(second!.show).not.toHaveBeenCalled();
    expect(first!.showInactive).toHaveBeenCalledTimes(1);
    expect(first!.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // The spare still loading shows when it paints.
    second!.paint();
    expect(second!.show).toHaveBeenCalledTimes(1);
  });

  it("resends the pick's state to a spare whose listener attached after its first state", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const [first] = created.map(({ window }) => window);

    void port.pick("frame", [left, right], "record");
    // It paints and is shown with its state before React has subscribed: that state is lost.
    first!.paint();
    first!.webContents.send.mockClear();

    first!.send(IPC_CHANNELS.screenshotOverlayStateRequest);
    expect(first!.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.screenshotOverlayState,
      expect.objectContaining({ mode: "frame", intent: "record" }),
    );
  });

  it("answers no state request outside a pick", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const [first] = created.map(({ window }) => window);
    first!.paint();

    first!.send(IPC_CHANNELS.screenshotOverlayStateRequest);
    expect(first!.webContents.send).not.toHaveBeenCalledWith(
      IPC_CHANNELS.screenshotOverlayState,
      expect.anything(),
    );
  });

  it("loads the spares with a neutral query: no frame, mode choice or intent in it", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);

    const searches = created.map(({ window }) =>
      String(window.loadFile.mock.calls[0]?.[1]?.search),
    );
    expect(searches[0]).toBe(
      "?window=capture-overlay&display=1&ui=frame&index=1&count=2" +
        "&bounds=0,0,1440,900&work=0,25,1440,875&ids=1,2&scale=2&spare=1",
    );
    for (const search of searches) {
      expect(search).not.toContain("frame=");
      expect(search).not.toContain("intent");
    }
  });

  it("reuses the spares when the cursor is on another display than at warm time", () => {
    vi.useFakeTimers();
    let cursor = { x: 100, y: 100 };
    const port = new CaptureOverlayWindows({
      platform: "darwin",
      enabledModes: CAPTURE_MODES,
      cursorPoint: () => cursor,
      warmup: {
        next: () => ({ ui: "frame", intent: "record", displays: [left, right] }),
        canWarm: () => true,
      },
      warmDelayMs: 100,
      warmRetryMs: 500,
    });
    port.prewarm();
    vi.advanceTimersByTime(0);
    const spares = created.map(({ window }) => window);
    for (const spare of spares) spare.paint();

    cursor = { x: 1500, y: 100 };
    void port.pick("frame", [left, right], "record");

    expect(created).toHaveLength(2);
    for (const spare of spares) expect(spare.destroy).not.toHaveBeenCalled();
    // The frame display reaches the loaded windows as state, and the cursor's window is key.
    expect(spares[1]!.show).toHaveBeenCalledTimes(1);
    expect(spares[0]!.showInactive).toHaveBeenCalledTimes(1);
    for (const spare of spares) {
      expect(spare.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.screenshotOverlayState,
        expect.objectContaining({ mode: "frame", intent: "record", frameDisplayId: 2 }),
      );
    }
  });

  it("reuses the spares for a pick in another mode or intent, sending both as state", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const spares = created.map(({ window }) => window);
    for (const spare of spares) spare.paint();

    void port.pick("screen", [left, right], "capture");

    expect(created).toHaveLength(2);
    for (const spare of spares) {
      expect(spare.destroy).not.toHaveBeenCalled();
      expect(spare.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.screenshotOverlayState,
        expect.objectContaining({ mode: "screen", intent: "capture", frameDisplayId: null }),
      );
    }
  });

  it("sends the state before it shows a painted spare", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const [first] = created.map(({ window }) => window);
    first!.paint();
    void port.pick("frame", [left, right], "record");

    const sendOrder = first!.webContents.send.mock.invocationCallOrder[0]!;
    expect(sendOrder).toBeLessThan(first!.showInactive.mock.invocationCallOrder[0]!);
  });

  it("throws the spares away and loads its own when the displays differ from the spares'", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const spares = created.map(({ window }) => window);

    void port.pick("frame", [left]);
    for (const spare of spares) expect(spare.destroy).toHaveBeenCalled();
    expect(created).toHaveLength(3);
  });

  it("throws the spares away when a display moved or changed scale", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const spares = created.map(({ window }) => window);

    void port.pick("frame", [left, display(2, 1440, 3)]);
    for (const spare of spares) expect(spare.destroy).toHaveBeenCalled();
    expect(created).toHaveLength(4);
  });

  describe("[record-timing] marks", () => {
    let info: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      info = vi.spyOn(console, "info").mockImplementation(() => {});
      beginRecordTiming("start clicked");
    });
    afterEach(() => {
      endRecordTiming("done");
      info.mockRestore();
    });
    const lines = () => info.mock.calls.map((call) => String(call[0]));

    it("says the spares were reused", () => {
      vi.useFakeTimers();
      const { port } = warmed();
      port.prewarm();
      vi.advanceTimersByTime(0);
      void port.pick("frame", [left, right], "record");
      expect(lines().some((line) => line.includes("overlay spares reused"))).toBe(true);
      expect(lines().some((line) => line.includes("overlay loaded fresh"))).toBe(false);
    });

    it("says the windows loaded fresh when there were no usable spares", () => {
      vi.useFakeTimers();
      const { port } = warmed();
      void port.pick("frame", [left, right], "record");
      expect(lines().some((line) => line.includes("overlay loaded fresh"))).toBe(true);
      expect(lines().some((line) => line.includes("overlay spares reused"))).toBe(false);
    });
  });

  it("loads the next spares once a pick ends, guessed from that pick's intent", () => {
    vi.useFakeTimers();
    const { port, next } = warmed();
    void port.pick("frame", [left, right]);
    expect(created).toHaveLength(2);

    port.destroyAll();
    vi.advanceTimersByTime(99);
    expect(created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenLastCalledWith("capture");
    expect(created).toHaveLength(4);
  });

  it("waits while the app is busy (a take), then loads", () => {
    vi.useFakeTimers();
    let busy = true;
    const { port } = warmed({ canWarm: () => !busy });
    port.prewarm();
    vi.advanceTimersByTime(0);
    expect(created).toHaveLength(0);

    busy = false;
    vi.advanceTimersByTime(500);
    expect(created).toHaveLength(2);
  });

  it("loads nothing when the next pick shows no overlay", () => {
    vi.useFakeTimers();
    const { port } = warmed({ next: null });
    port.prewarm();
    vi.advanceTimersByTime(1000);
    expect(created).toHaveLength(0);
  });

  it("a display change reloads the spares for the new layout", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    const spares = created.map(({ window }) => window);

    screenListeners.get("display-metrics-changed")!({}, left);
    for (const spare of spares) expect(spare.destroy).toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(created).toHaveLength(4);
  });

  it("a spare whose renderer crashed is never used", () => {
    vi.useFakeTimers();
    const { port } = warmed();
    port.prewarm();
    vi.advanceTimersByTime(0);
    created[0]!.window.crashRenderer();
    expect(created[1]!.window.destroy).toHaveBeenCalled();

    void port.pick("frame", [left, right], "record");
    expect(created).toHaveLength(4);
  });

  it("loads nothing without a warm-up (the default)", () => {
    vi.useFakeTimers();
    const port = overlays();
    port.prewarm();
    void port.pick("frame", [left]);
    port.destroyAll();
    vi.advanceTimersByTime(60_000);
    expect(created).toHaveLength(1);
  });
});

describe("the capture overlays on quit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function warmedPort() {
    return new CaptureOverlayWindows({
      platform: "darwin",
      enabledModes: CAPTURE_MODES,
      warmup: {
        next: () => ({ ui: "frame", intent: "record", displays: [left, right] }),
        canWarm: () => true,
      },
      warmDelayMs: 100,
      warmRetryMs: 500,
    });
  }

  it("dispose() destroys the loaded spares and a later prewarm() loads nothing", () => {
    vi.useFakeTimers();
    const port = warmedPort();
    port.prewarm();
    vi.advanceTimersByTime(0);
    expect(created).toHaveLength(2);

    port.dispose();

    for (const { window } of created) expect(window.destroy).toHaveBeenCalledTimes(1);
    port.prewarm();
    vi.advanceTimersByTime(1000);
    expect(created).toHaveLength(2);
  });

  it("dispose() cancels a warm-up still pending, so the quit never sees a late window", () => {
    vi.useFakeTimers();
    const port = warmedPort();
    port.refreshSpares(); // no spares yet: a no-op
    port.prewarm();

    port.dispose();
    vi.advanceTimersByTime(1000);

    expect(created).toHaveLength(0);
  });
});
