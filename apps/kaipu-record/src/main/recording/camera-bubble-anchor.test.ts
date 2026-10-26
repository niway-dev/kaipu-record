import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The camera bubble is recorded as part of the screen, so during an area recording it must
 * sit inside the area or not show at all (ADR 0030, spec decision 6).
 */

const created: FakeWindow[] = [];

class FakeWindow {
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setBounds = vi.fn();
  showInactive = vi.fn();
  hide = vi.fn();
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
  isVisible = () => true;
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

const FITS = { x: 1612, y: 50, width: 640, height: 360 };
const TOO_SMALL = { x: 0, y: 0, width: 300, height: 300 };

describe("CameraBubbleWindow.anchorTo", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("moves a shown bubble inside an area that can hold it", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    bubble.anchorTo(FITS);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 1652,
      y: 146,
      width: 224,
      height: 224,
    });
    expect(created[0].hide).not.toHaveBeenCalled();
  });

  it("hides a shown bubble when the area is too small for it", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    bubble.anchorTo(TOO_SMALL);
    expect(created[0].hide).toHaveBeenCalled();
  });

  it("keeps a bubble turned on mid-take hidden while the area cannot hold it", () => {
    const bubble = new CameraBubbleWindow();
    bubble.anchorTo(TOO_SMALL);
    bubble.show();
    created[0].readyToShow?.();
    expect(created[0].showInactive).not.toHaveBeenCalled();
    bubble.show(); // a second toggle on the existing window
    expect(created[0].showInactive).not.toHaveBeenCalled();
  });

  it("goes back to the display's bottom-left corner when the anchor is cleared", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    bubble.anchorTo(FITS);
    bubble.anchorTo(null);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 40,
      y: 636,
      width: 224,
      height: 224,
    });
  });
});
