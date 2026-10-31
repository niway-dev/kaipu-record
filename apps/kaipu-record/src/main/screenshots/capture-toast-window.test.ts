import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureToastPayload } from "@shared/types/screenshot-capture";

vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn() }, screen: {} }));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const {
  CaptureToastWindow,
  saveFromToast,
  TOAST_AUTO_HIDE_MS,
  TOAST_HEIGHT,
  TOAST_MARGIN,
  TOAST_WIDTH,
  toastBounds,
} = await import("./capture-toast-window");
type QuietCapture = import("./last-quiet-capture").QuietCapture;

const CHANNEL = {
  show: "screenshot:toast-show",
  action: "screenshot:toast-action",
  hover: "screenshot:toast-hover",
  ready: "screenshot:toast-ready",
};

class FakeWebContents {
  sent: Array<{ channel: string; payload: unknown }> = [];
  send = vi.fn((channel: string, payload: unknown) => this.sent.push({ channel, payload }));
}

class FakeWindow {
  webContents = new FakeWebContents();
  setAlwaysOnTop = vi.fn();
  setContentProtection = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setBounds = vi.fn();
  showInactive = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
  });
  visible = false;
  isVisible = () => this.visible;
  private destroyed = false;
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.closed?.();
  });
  isDestroyed = () => this.destroyed;
  private closed: (() => void) | null = null;
  on = vi.fn((event: string, callback: () => void) => {
    if (event === "closed") this.closed = callback;
  });
  close(): void {
    this.closed?.();
  }
}

/** A minimal `ipcMain`: listeners by channel, emitted with a chosen sender. */
class FakeIpc {
  private listeners = new Map<string, (event: { sender: unknown }, payload?: unknown) => void>();
  on = (channel: string, listener: (event: { sender: unknown }, payload?: unknown) => void) => {
    this.listeners.set(channel, listener);
  };
  emit(channel: string, sender: unknown, payload?: unknown): void {
    this.listeners.get(channel)?.({ sender }, payload);
  }
}

/** Manual timers: `tick(ms)` fires whatever is due. */
class FakeTimers {
  now = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  set = (fn: () => void, ms: number): number => {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  };
  clear = (id: unknown): void => {
    this.pending.delete(id as number);
  };
  tick(ms: number): void {
    this.now += ms;
    for (const [id, timer] of this.pending) {
      if (timer.at <= this.now) {
        this.pending.delete(id);
        timer.fn();
      }
    }
  }
}

const PRIMARY = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
/** A display to the left of the primary one: negative x. */
const LEFT = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1050 } };

const COPIED: CaptureToastPayload = {
  thumbnail: "data:image/png;base64,AAAA",
  width: 1126,
  height: 604,
  mode: "frame",
  saved: null,
  copied: true,
};
const SAVED: CaptureToastPayload = { ...COPIED, saved: { id: "screenshot-1" }, copied: false };

const SHOT: QuietCapture = {
  png: Buffer.from([1, 2, 3]),
  width: 1126,
  height: 604,
  mode: "frame",
  workspaceId: "ws-work",
};
const NEXT_SHOT: QuietCapture = { ...SHOT, png: Buffer.from([4, 5, 6]) };

function setup(options: { kept?: QuietCapture | null; save?: () => Promise<{ id: string }> } = {}) {
  const windows: FakeWindow[] = [];
  const createOptions: Array<Record<string, unknown>> = [];
  const ipc = new FakeIpc();
  const timers = new FakeTimers();
  // The `last-quiet-capture` store: the kept bytes and the capture sequence they belong to.
  let kept: QuietCapture | null = options.kept === undefined ? SHOT : options.kept;
  let sequence = 1;
  const deps = {
    createWindow: vi.fn((opts: Record<string, unknown>) => {
      createOptions.push(opts);
      const window = new FakeWindow();
      windows.push(window);
      return window;
    }),
    load: vi.fn(),
    ipc,
    screen: {
      getAllDisplays: () => [PRIMARY, LEFT],
      getPrimaryDisplay: () => PRIMARY,
    },
    setTimer: timers.set,
    clearTimer: timers.clear,
    platform: "darwin" as NodeJS.Platform,
    takeQuietCapture: vi.fn(() => {
      const taken = kept;
      kept = null;
      return taken;
    }),
    peekQuietCapture: vi.fn(() => (kept ? { capture: kept, sequence } : null)),
    releaseQuietCapture: vi.fn((of: number) => {
      if (of === sequence) kept = null;
    }),
    saveToVault: vi.fn(options.save ?? (async () => ({ id: "screenshot-new" }))),
    title: () => "Kaipu Screenshot now",
    openSaved: vi.fn(),
    openQuietCapture: vi.fn(),
  };
  const toast = new CaptureToastWindow(deps);
  /** The toast renderer mounted and subscribed. */
  const ready = (index = 0): void => ipc.emit(CHANNEL.ready, windows[index]!.webContents);
  const act = (action: string): void =>
    ipc.emit(CHANNEL.action, windows[0]!.webContents, { action });
  const shown = (index = 0) =>
    windows[index]!.webContents.sent.filter((m) => m.channel === CHANNEL.show).map(
      (m) => m.payload,
    );
  /** A new capture starts (the handler clears the store) and, if quiet copy-only, keeps `next`. */
  const newCapture = (next: QuietCapture | null = null): void => {
    sequence += 1;
    kept = next;
  };
  const keptNow = (): QuietCapture | null => kept;
  const hover = (paused: boolean): void =>
    ipc.emit(CHANNEL.hover, windows[0]!.webContents, { paused });
  return {
    toast,
    deps,
    windows,
    createOptions,
    ipc,
    timers,
    ready,
    act,
    shown,
    newCapture,
    keptNow,
    hover,
  };
}

describe("saveFromToast", () => {
  it("writes like the capture's auto-save (manual: false), so the shot stays off the editor's Continue list", async () => {
    const save = vi.fn(
      async (
        _workspaceId: string | null,
        _png: Buffer,
        _meta: { title: string; manual?: boolean },
      ) => ({
        id: "screenshot-9",
        title: "ignored",
      }),
    );
    await expect(saveFromToast(save)(SHOT.png, "Kaipu Screenshot now", "ws-work")).resolves.toEqual(
      {
        id: "screenshot-9",
      },
    );
    // Into the workspace the capture started in, never the one active at the click.
    expect(save).toHaveBeenCalledWith("ws-work", SHOT.png, {
      title: "Kaipu Screenshot now",
      manual: false,
    });
  });
});

describe("CaptureToastWindow", () => {
  const realPlatform = process.platform;
  beforeAll(() => Object.defineProperty(process, "platform", { value: "darwin" }));
  afterAll(() => Object.defineProperty(process, "platform", { value: realPlatform }));

  describe("one window", () => {
    it("is created lazily as a frameless, non-focusable, floating panel", () => {
      const { toast, deps, windows, createOptions } = setup();
      expect(deps.createWindow).not.toHaveBeenCalled();

      toast.show({ ...COPIED, displayId: 1 });

      expect(createOptions[0]).toMatchObject({
        width: TOAST_WIDTH,
        height: TOAST_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        focusable: false,
        resizable: false,
        fullscreenable: false,
        type: "panel",
      });
      expect(windows[0]!.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
      expect(deps.load).toHaveBeenCalledTimes(1);
    });

    it("is content-protected, so no screenshot or window capture ever contains it", () => {
      const { toast, windows } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      expect(windows[0]!.setContentProtection).toHaveBeenCalledWith(true);
    });

    it("is re-targeted by a second capture instead of stacking a second toast", () => {
      const { toast, deps, windows, ready, shown } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      toast.show({ ...SAVED, displayId: 2 });

      expect(deps.createWindow).toHaveBeenCalledTimes(1);
      expect(windows).toHaveLength(1);
      expect(shown()).toEqual([COPIED, SAVED]);
      expect(windows[0]!.setBounds).toHaveBeenLastCalledWith(toastBounds(LEFT.workArea));
    });

    it("waits for the renderer before showing, then sends the latest payload once", () => {
      const { toast, windows, ready, shown } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      toast.show({ ...SAVED, displayId: 1 });
      expect(windows[0]!.showInactive).not.toHaveBeenCalled();

      ready();

      expect(shown()).toEqual([SAVED]);
      expect(windows[0]!.showInactive).toHaveBeenCalledTimes(1);
    });

    it("never sends the payload over the IPC of another window", () => {
      const { toast, windows, ipc, shown } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ipc.emit(CHANNEL.ready, new FakeWebContents());
      expect(shown()).toEqual([]);
      expect(windows[0]!.showInactive).not.toHaveBeenCalled();
    });

    it("builds a fresh window after the old one was closed", () => {
      const { toast, deps, windows } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      windows[0]!.close();
      toast.show({ ...COPIED, displayId: 1 });
      expect(deps.createWindow).toHaveBeenCalledTimes(2);
    });
  });

  describe("full-screen Spaces (macOS)", () => {
    it("joins every Space only while shown, without touching the Dock", () => {
      const { toast, windows, ready } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      expect(windows[0]!.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();

      ready();
      expect(windows[0]!.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });

      toast.dismiss();
      expect(windows[0]!.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(false, {
        visibleOnFullScreen: false,
        skipTransformProcessType: true,
      });
    });
  });

  describe("position", () => {
    it("sits at the top-right of the work area with the margin", () => {
      expect(toastBounds(PRIMARY.workArea)).toEqual({
        x: 1440 - TOAST_WIDTH - TOAST_MARGIN,
        y: 25 + TOAST_MARGIN,
        width: TOAST_WIDTH,
        height: TOAST_HEIGHT,
      });
    });

    it("stays on a display left of the primary one", () => {
      const bounds = toastBounds(LEFT.workArea);
      expect(bounds.x).toBe(-TOAST_WIDTH - TOAST_MARGIN);
      expect(bounds.x).toBeGreaterThanOrEqual(LEFT.workArea.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(LEFT.workArea.x + LEFT.workArea.width);
    });

    it("never leaves a work area narrower than the toast", () => {
      const bounds = toastBounds({ x: 100, y: 0, width: 300, height: 400 });
      expect(bounds.x).toBe(100);
    });

    it("goes to the display of the capture, and to the primary one when that display is gone", () => {
      const { toast, windows, ready } = setup();
      toast.show({ ...COPIED, displayId: 2 });
      ready();
      expect(windows[0]!.setBounds).toHaveBeenLastCalledWith(toastBounds(LEFT.workArea));
      toast.show({ ...COPIED, displayId: 99 });
      expect(windows[0]!.setBounds).toHaveBeenLastCalledWith(toastBounds(PRIMARY.workArea));
    });
  });

  describe("auto-hide", () => {
    it("hides after 6 s", () => {
      const { toast, windows, timers, ready } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      timers.tick(TOAST_AUTO_HIDE_MS - 1);
      expect(windows[0]!.hide).not.toHaveBeenCalled();
      timers.tick(1);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
    });

    it("restarts the 6 s on a new capture", () => {
      const { toast, windows, timers, ready } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      timers.tick(5_000);
      toast.show({ ...SAVED, displayId: 1 });
      timers.tick(5_000);
      expect(windows[0]!.hide).not.toHaveBeenCalled();
      timers.tick(1_000);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
    });

    it("pauses while the pointer is over the card and restarts when it leaves", () => {
      const { toast, windows, timers, ready, ipc } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      timers.tick(3_000);
      ipc.emit(CHANNEL.hover, windows[0]!.webContents, { paused: true });
      timers.tick(60_000);
      expect(windows[0]!.hide).not.toHaveBeenCalled();

      ipc.emit(CHANNEL.hover, windows[0]!.webContents, { paused: false });
      timers.tick(TOAST_AUTO_HIDE_MS - 1);
      expect(windows[0]!.hide).not.toHaveBeenCalled();
      timers.tick(1);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
    });

    it("starts the 6 s only once the renderer shows the first toast", () => {
      const { toast, windows, timers, ready } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      // A cold toast renderer can take a while to load: the card has not been seen yet.
      timers.tick(10_000);
      expect(windows[0]!.hide).not.toHaveBeenCalled();

      ready();
      timers.tick(TOAST_AUTO_HIDE_MS - 1);
      expect(windows[0]!.hide).not.toHaveBeenCalled();
      timers.tick(1);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
    });

    it("keeps holding when a new capture re-targets the toast under the pointer", () => {
      const { toast, windows, timers, ready, hover } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      hover(true);

      toast.show({ ...SAVED, displayId: 1 });
      timers.tick(60_000);
      expect(windows[0]!.hide).not.toHaveBeenCalled();

      hover(false);
      timers.tick(TOAST_AUTO_HIDE_MS);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
    });

    it("forgets the pointer once the toast is hidden, so the next toast counts down", () => {
      const { toast, windows, timers, ready, hover } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      hover(true);
      toast.dismiss(); // hidden under the pointer: no "left" ever arrives
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);

      toast.show({ ...COPIED, displayId: 1 });
      timers.tick(TOAST_AUTO_HIDE_MS);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(2);
    });

    it("dismiss hides at once and cancels the timer", () => {
      const { toast, windows, timers, ready, act } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("dismiss");
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
      timers.tick(TOAST_AUTO_HIDE_MS);
      expect(windows[0]!.hide).toHaveBeenCalledTimes(1);
    });

    it("auto-hide never frees the copy-only bytes (failure 5)", () => {
      const { toast, deps, timers, ready } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      timers.tick(TOAST_AUTO_HIDE_MS);
      expect(deps.takeQuietCapture).not.toHaveBeenCalled();
    });

    it("ignores an unknown action", () => {
      const { toast, deps, windows, ready, act } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("format-disk");
      expect(windows[0]!.hide).not.toHaveBeenCalled();
      expect(deps.openSaved).not.toHaveBeenCalled();
    });
  });

  describe("Annotate", () => {
    it("opens the saved vault item in the editor", () => {
      const { toast, deps, ready, act, windows } = setup();
      toast.show({ ...SAVED, displayId: 1 });
      ready();
      act("annotate");
      expect(deps.openSaved).toHaveBeenCalledWith("editor", "screenshot-1");
      expect(deps.takeQuietCapture).not.toHaveBeenCalled();
      expect(windows[0]!.hide).toHaveBeenCalled();
    });

    it("hands a copy-only capture's kept bytes to the editor exactly once", () => {
      const { toast, deps, ready, act } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("annotate");
      act("annotate");
      expect(deps.openQuietCapture).toHaveBeenCalledTimes(1);
      expect(deps.openQuietCapture).toHaveBeenCalledWith(SHOT);
      expect(deps.openSaved).not.toHaveBeenCalled();
    });

    it("does nothing when the bytes are already gone", () => {
      const { toast, deps, ready, act } = setup({ kept: null });
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("annotate");
      expect(deps.openQuietCapture).not.toHaveBeenCalled();
    });

    it("opens the saved item when Save happened in between", async () => {
      const { toast, deps, ready, act } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      await vi.waitFor(() => expect(deps.saveToVault).toHaveBeenCalled());
      await Promise.resolve();
      act("annotate");
      expect(deps.openQuietCapture).not.toHaveBeenCalled();
      expect(deps.openSaved).toHaveBeenCalledWith("editor", "screenshot-new");
    });
  });

  describe("Open in Library", () => {
    it("opens the saved item's Library page", () => {
      const { toast, deps, ready, act } = setup();
      toast.show({ ...SAVED, displayId: 1 });
      ready();
      act("open-library");
      expect(deps.openSaved).toHaveBeenCalledWith("library", "screenshot-1");
    });

    it("does nothing on a toast with nothing saved", () => {
      const { toast, deps, ready, act } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("open-library");
      expect(deps.openSaved).not.toHaveBeenCalled();
    });
  });

  describe("Save to Library", () => {
    it("writes the kept bytes once, re-sends the payload with saved, then frees the bytes", async () => {
      const { toast, deps, ready, act, shown, keptNow } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      act("save");
      await vi.waitFor(() => expect(shown()).toHaveLength(2));

      expect(deps.saveToVault).toHaveBeenCalledTimes(1);
      expect(deps.saveToVault).toHaveBeenCalledWith(SHOT.png, "Kaipu Screenshot now", "ws-work");
      expect(shown()[1]).toEqual({ ...COPIED, saved: { id: "screenshot-new" } });
      // The vault has the shot now: Annotate opens that item, the bytes are not needed.
      expect(keptNow()).toBeNull();

      act("save");
      expect(deps.saveToVault).toHaveBeenCalledTimes(1);
    });

    it("reads the bytes without removing them while the write runs", () => {
      const { toast, deps, ready, act, keptNow } = setup({ save: () => new Promise(() => {}) });
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      expect(deps.saveToVault).toHaveBeenCalledOnce();
      expect(deps.takeQuietCapture).not.toHaveBeenCalled();
      expect(keptNow()).toBe(SHOT);
    });

    it("keeps the bytes for Annotate when the write fails", async () => {
      const { toast, deps, ready, act, shown, keptNow } = setup({
        save: async () => {
          throw new Error("disk full");
        },
      });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      expect(shown()).toHaveLength(1);
      expect(keptNow()).toBe(SHOT);
      act("annotate");
      expect(deps.openQuietCapture).toHaveBeenCalledWith(SHOT);
      error.mockRestore();
    });

    it("a Save on a new toast is not blocked by the previous toast's Save still writing", async () => {
      const finishes: Array<(value: { id: string }) => void> = [];
      const { toast, deps, ready, act, newCapture } = setup({
        save: () => new Promise((resolve) => finishes.push(resolve)),
      });
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      newCapture(NEXT_SHOT);
      toast.show({ ...COPIED, displayId: 1 });

      act("save");

      expect(deps.saveToVault).toHaveBeenCalledTimes(2);
      expect(deps.saveToVault).toHaveBeenLastCalledWith(
        NEXT_SHOT.png,
        "Kaipu Screenshot now",
        "ws-work",
      );
      finishes.forEach((finish) => finish({ id: "screenshot-x" }));
    });

    it("Annotate during a Save waits for it and opens the saved item, exactly once", async () => {
      let finish: (value: { id: string }) => void = () => {};
      const { toast, deps, ready, act, windows, keptNow } = setup({
        save: () => new Promise((resolve) => (finish = resolve)),
      });
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      act("annotate");
      act("annotate");
      expect(deps.openQuietCapture).not.toHaveBeenCalled();
      expect(deps.openSaved).not.toHaveBeenCalled();

      finish({ id: "screenshot-new" });
      await vi.waitFor(() => expect(deps.openSaved).toHaveBeenCalled());

      // One vault item, opened in the editor (failure 4): the bytes are not handed over too.
      expect(deps.openSaved).toHaveBeenCalledExactlyOnceWith("editor", "screenshot-new");
      expect(deps.openQuietCapture).not.toHaveBeenCalled();
      expect(windows[0]!.hide).toHaveBeenCalled();
      expect(keptNow()).toBeNull();
    });

    it("Annotate during a Save that fails hands the bytes to the editor", async () => {
      let fail: (error: Error) => void = () => {};
      const { toast, deps, ready, act } = setup({
        save: () => new Promise((_resolve, reject) => (fail = reject)),
      });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      act("annotate");

      fail(new Error("disk full"));
      await vi.waitFor(() => expect(deps.openQuietCapture).toHaveBeenCalled());

      expect(deps.openQuietCapture).toHaveBeenCalledExactlyOnceWith(SHOT);
      expect(deps.openSaved).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it("a Save that finishes after a new capture started never frees that capture's bytes", async () => {
      let finish: (value: { id: string }) => void = () => {};
      const { toast, ready, act, newCapture, keptNow } = setup({
        save: () => new Promise((resolve) => (finish = resolve)),
      });
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      newCapture(NEXT_SHOT);

      finish({ id: "screenshot-old" });
      await Promise.resolve();
      await Promise.resolve();

      expect(keptNow()).toBe(NEXT_SHOT);
    });

    it("a failed Save after a new capture started hands nothing to the editor", async () => {
      let fail: (error: Error) => void = () => {};
      const { toast, deps, ready, act, newCapture, keptNow } = setup({
        save: () => new Promise((_resolve, reject) => (fail = reject)),
      });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      act("annotate");
      // What a capture start does: beforeCapture dismisses the toast, the handler clears the store.
      toast.dismiss();
      newCapture(NEXT_SHOT);

      fail(new Error("disk full"));
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(deps.openQuietCapture).not.toHaveBeenCalled();
      expect(keptNow()).toBe(NEXT_SHOT);
      error.mockRestore();
    });

    it("does not resurrect an old toast when a new capture replaced it during the write", async () => {
      let finish: (value: { id: string }) => void = () => {};
      const { toast, ready, act, shown } = setup({
        save: () => new Promise((resolve) => (finish = resolve)),
      });
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      toast.show({ ...SAVED, displayId: 1 });
      finish({ id: "screenshot-late" });
      await Promise.resolve();
      await Promise.resolve();
      expect(shown()).toEqual([COPIED, SAVED]);
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CaptureToastWindow on quit", () => {
  it("destroy() drops the window outright and a later show() creates no other", () => {
    const { toast, deps, windows } = setup();
    toast.show({ ...COPIED, displayId: 1 });
    expect(windows).toHaveLength(1);

    toast.destroy();

    expect(windows[0]!.destroy).toHaveBeenCalledTimes(1);
    toast.show({ ...COPIED, displayId: 1 });
    expect(deps.createWindow).toHaveBeenCalledTimes(1);
  });
});
