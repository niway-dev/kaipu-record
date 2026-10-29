import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `raise()` orders the bubble above the other floating windows. On macOS `moveTop()` also
 * orders a hidden window back on screen, so a bubble hidden for a screenshot (or never
 * shown) must stay where it is when the countdown raises the floating windows.
 */

const created: FakeWindow[] = [];

class FakeWindow {
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  bounds = { x: 0, y: 0, width: 288, height: 288 };
  setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
    this.bounds = bounds;
  });
  getBounds = () => this.bounds;
  visible = false;
  showInactive = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
  });
  destroy = vi.fn();
  moveTop = vi.fn();
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  readyToShow: (() => void) | null = null;
  once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready-to-show") this.readyToShow = callback;
  });
  on = vi.fn();
  isDestroyed = () => false;
  isVisible = () => this.visible;
  constructor() {
    created.push(this);
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { CameraBubbleWindow } = await import("./camera-bubble-window");

beforeEach(() => {
  created.length = 0;
});

describe("CameraBubbleWindow.raise", () => {
  it("does nothing without a window", () => {
    const bubble = new CameraBubbleWindow();
    bubble.raise();
    expect(created).toHaveLength(0);
  });

  it("leaves a hidden bubble off screen: moveTop would order it back on macOS", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    created[0]!.readyToShow?.();
    bubble.hide();

    bubble.raise();
    expect(created[0]!.moveTop).not.toHaveBeenCalled();

    bubble.show();
    bubble.raise();
    expect(created[0]!.moveTop).toHaveBeenCalledTimes(1);
  });
});

describe("CameraBubbleWindow on quit", () => {
  it("dispose() drops the window outright and a later show() creates no other", () => {
    const bubble = new CameraBubbleWindow(() => 288);
    bubble.show();
    const [window] = created;

    bubble.dispose();

    expect(window!.destroy).toHaveBeenCalledTimes(1);
    bubble.show();
    expect(created).toHaveLength(1);
  });

  it("destroy() between takes still allows the next take's bubble", () => {
    const bubble = new CameraBubbleWindow(() => 288);
    bubble.show();
    bubble.destroy();

    bubble.show();

    expect(created).toHaveLength(2);
  });
});
