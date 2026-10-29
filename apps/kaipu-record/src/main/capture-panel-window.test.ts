import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = [];

class FakeWindow {
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setPosition = vi.fn();
  getSize = () => [340, 380];
  show = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  isVisible = () => false;
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  private readyToShow: (() => void) | null = null;
  once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready-to-show") this.readyToShow = callback;
  });
  on = vi.fn();
  private destroyed = false;
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
  isDestroyed = () => this.destroyed;
  constructor(options: Record<string, unknown>) {
    created.push({ options, window: this });
  }
  paint(): void {
    this.readyToShow?.();
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  ipcMain: { on: vi.fn() },
  screen: {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { CapturePanelWindow } = await import("./capture-panel-window");

const trayBounds = { x: 1200, y: 0, width: 24, height: 24 };
const realPlatform = process.platform;

describe("CapturePanelWindow over a full-screen app (macOS)", () => {
  beforeAll(() => {
    Object.defineProperty(process, "platform", { value: "darwin" });
  });
  afterAll(() => {
    Object.defineProperty(process, "platform", { value: realPlatform });
  });
  beforeEach(() => {
    created.length = 0;
  });

  it("is a floating panel that never asks for a full-screen Space of its own", () => {
    new CapturePanelWindow().prewarm();

    const [{ options, window }] = created;
    expect(options.type).toBe("panel");
    expect(options.fullscreenable).toBe(false);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
  });

  it("does not join full-screen Spaces while hidden, so the app's menu bar keeps working", () => {
    new CapturePanelWindow().prewarm();

    expect(created[0].window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });

  it("joins every Space while open and leaves them when hidden, without touching the Dock", () => {
    const panel = new CapturePanelWindow();
    panel.prewarm();
    const { window } = created[0];
    window.paint();

    panel.show(trayBounds);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(window.show).toHaveBeenCalled();

    panel.hide();
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(false, {
      visibleOnFullScreen: false,
      skipTransformProcessType: true,
    });
  });
});

describe("CapturePanelWindow on quit", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("destroy() drops the window outright and a later prewarm() or show() creates no other", () => {
    const panel = new CapturePanelWindow();
    panel.prewarm();
    const [{ window }] = created;

    panel.destroy();

    expect(window.destroy).toHaveBeenCalledTimes(1);
    panel.prewarm();
    panel.show({ x: 0, y: 0, width: 24, height: 24 });
    expect(created).toHaveLength(1);
  });
});
