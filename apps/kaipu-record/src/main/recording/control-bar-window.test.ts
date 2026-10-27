import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_BAR_STARTING_TICK, IPC_CHANNELS, type RecordingTick } from "@shared/types/ipc";

/**
 * The bar window outlives a take (it is hidden on stop, not destroyed) and its first window
 * loads a whole renderer before it can paint. Both used to show the user something that was
 * no longer true: the last take's "Saving…" at the next start, or a bar over an idle app.
 */

const created: FakeWindow[] = [];

class FakeWindow {
  private readonly handlers = new Map<string, () => void>();
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setContentProtection = vi.fn();
  moveTop = vi.fn();
  setBounds = vi.fn();
  showInactive = vi.fn();
  hide = vi.fn();
  destroy = vi.fn();
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  once = vi.fn((event: string, handler: () => void) => this.handlers.set(event, handler));
  on = vi.fn();
  isDestroyed = () => false;
  webContents = { send: vi.fn() };
  constructor() {
    created.push(this);
  }
  /** Electron's first paint of the page. */
  readyToShow(): void {
    this.handlers.get("ready-to-show")?.();
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getAllDisplays: () => [],
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { ControlBarWindow } = await import("./control-bar-window");

const RECORDING: RecordingTick = {
  elapsedSeconds: 7,
  levels: [0, 0, 0, 0, 0],
  status: "recording",
};
const SAVING: RecordingTick = { elapsedSeconds: 7, levels: [0, 0, 0, 0, 0], status: "saving" };

describe("control bar window", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("stays hidden when the take ended before its first window loaded", () => {
    const bar = new ControlBarWindow();
    bar.show();
    // A start that failed fast, or a Stop within the first few hundred ms.
    bar.hide();
    created[0].readyToShow();

    expect(created[0].showInactive).not.toHaveBeenCalled();
  });

  it("shows a loading window once it has painted, with the latest tick it missed", () => {
    const bar = new ControlBarWindow();
    bar.show();
    // Sent while the page loaded: nothing in the renderer listened yet.
    bar.sendTick(RECORDING);
    created[0].webContents.send.mockClear();
    created[0].readyToShow();

    expect(created[0].webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.controlTick, RECORDING);
    expect(created[0].showInactive).toHaveBeenCalledTimes(1);
  });

  it("a second show while the first window still loads waits for it instead of showing a blank one", () => {
    const bar = new ControlBarWindow();
    bar.show();
    bar.show();
    expect(created).toHaveLength(1);
    expect(created[0].showInactive).not.toHaveBeenCalled();
    created[0].readyToShow();
    expect(created[0].showInactive).toHaveBeenCalledTimes(1);
  });

  it("a reused window is repainted as starting when hidden, never keeping the last take's Saving", () => {
    const bar = new ControlBarWindow();
    bar.show();
    created[0].readyToShow();
    bar.sendTick(SAVING);
    bar.hide();

    expect(created[0].webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.controlTick,
      CONTROL_BAR_STARTING_TICK,
    );
    bar.show();
    expect(created).toHaveLength(1);
    expect(created[0].showInactive).toHaveBeenCalledTimes(2);
  });

  it("reset repaints the bar as starting", () => {
    const bar = new ControlBarWindow();
    bar.show();
    created[0].readyToShow();
    bar.sendTick(SAVING);
    bar.reset();
    expect(created[0].webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.controlTick,
      CONTROL_BAR_STARTING_TICK,
    );
  });
});
