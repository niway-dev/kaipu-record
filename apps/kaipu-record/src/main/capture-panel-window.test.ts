import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = [];

class FakeWindow {
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  once = vi.fn();
  on = vi.fn();
  isDestroyed = () => false;
  constructor(options: Record<string, unknown>) {
    created.push({ options, window: this });
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  ipcMain: { on: vi.fn() },
  screen: { getDisplayNearestPoint: vi.fn() },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { CapturePanelWindow } = await import("./capture-panel-window");

describe("CapturePanelWindow over a full-screen app", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("joins every Space, full-screen ones included, so it never opens on a Space of its own", () => {
    new CapturePanelWindow().prewarm();

    const [{ options, window }] = created;
    expect(options.fullscreenable).toBe(false);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
  });
});
