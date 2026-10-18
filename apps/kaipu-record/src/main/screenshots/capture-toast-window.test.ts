import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureToastPayload } from "@shared/types/screenshot-capture";

vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: { on: vi.fn() }, screen: {} }));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const {
  CaptureToastWindow,
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
  isDestroyed = () => false;
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

const SHOT: QuietCapture = { png: Buffer.from([1, 2, 3]), width: 1126, height: 604, mode: "frame" };

function setup(options: { kept?: QuietCapture | null; save?: () => Promise<{ id: string }> } = {}) {
  const windows: FakeWindow[] = [];
  const createOptions: Array<Record<string, unknown>> = [];
  const ipc = new FakeIpc();
  const timers = new FakeTimers();
  let kept: QuietCapture | null = options.kept === undefined ? SHOT : options.kept;
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
    keepQuietCapture: vi.fn((capture: QuietCapture) => {
      kept = capture;
    }),
    saveToVault: vi.fn(options.save ?? (async () => ({ id: "screenshot-new" }))),
    title: () => "Screenshot — now",
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
  return { toast, deps, windows, createOptions, ipc, timers, ready, act, shown };
}

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
    it("writes the kept bytes once as a manual save and re-sends the payload with saved", async () => {
      const { toast, deps, ready, act, shown } = setup();
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      act("save");
      await vi.waitFor(() => expect(shown()).toHaveLength(2));

      expect(deps.saveToVault).toHaveBeenCalledTimes(1);
      expect(deps.saveToVault).toHaveBeenCalledWith(SHOT.png, "Screenshot — now");
      expect(shown()[1]).toEqual({ ...COPIED, saved: { id: "screenshot-new" } });

      act("save");
      expect(deps.saveToVault).toHaveBeenCalledTimes(1);
    });

    it("keeps the bytes for Annotate when the write fails", async () => {
      const { toast, deps, ready, act, shown } = setup({
        save: async () => {
          throw new Error("disk full");
        },
      });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      toast.show({ ...COPIED, displayId: 1 });
      ready();
      act("save");
      await vi.waitFor(() => expect(deps.keepQuietCapture).toHaveBeenCalledWith(SHOT));
      expect(shown()).toHaveLength(1);
      act("annotate");
      expect(deps.openQuietCapture).toHaveBeenCalledWith(SHOT);
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
