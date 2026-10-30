import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `raise()` orders the bubble above the other floating windows. On macOS `moveTop()` also
 * orders a hidden window back on screen, so a bubble hidden for a screenshot (or never
 * shown) must stay where it is when the countdown raises the floating windows.
 */

const created: FakeWindow[] = [];

const os = vi.hoisted(() => ({ release: "24.0.0" }));
vi.mock("node:os", () => ({ release: () => os.release }));

class FakeWindow {
  setContentProtection = vi.fn();
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
  os.release = "24.0.0";
});

/**
 * The bubble is excluded from the screen capture from creation (ADR 0032): its face is in the
 * webcam file, so the screen recording must not carry it a second time. Before Windows 10
 * 2004 exclusion paints the window black instead, so there the legacy path stays.
 */
describe("CameraBubbleWindow content protection", () => {
  const realPlatform = process.platform;
  const setPlatform = (platform: string): void => {
    Object.defineProperty(process, "platform", { value: platform });
  };
  afterEach(() => setPlatform(realPlatform));

  it("protects the window as soon as it exists, before anything loads into it", () => {
    new CameraBubbleWindow().show();
    const win = created[0]!;
    expect(win.setContentProtection).toHaveBeenCalledExactlyOnceWith(true);
    expect(win.setContentProtection.mock.invocationCallOrder[0]).toBeLessThan(
      win.loadFile.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("protects it on macOS and on a current Windows build", () => {
    setPlatform("darwin");
    new CameraBubbleWindow().show();
    setPlatform("win32");
    os.release = "10.0.22631";
    new CameraBubbleWindow().show();
    expect(created.map((w) => w.setContentProtection.mock.calls)).toEqual([[[true]], [[true]]]);
  });

  it("leaves it unprotected on Windows before 10 2004, where it would be captured black", () => {
    setPlatform("win32");
    os.release = "10.0.18363";
    new CameraBubbleWindow().show();
    expect(created[0]!.setContentProtection).not.toHaveBeenCalled();
  });

  it("follows an injected rule", () => {
    new CameraBubbleWindow(undefined, () => false).show();
    expect(created[0]!.setContentProtection).not.toHaveBeenCalled();
  });
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

describe("CameraBubbleWindow.visibleBounds", () => {
  it("is the window's bounds while the bubble is shown, null before and after", () => {
    const bubble = new CameraBubbleWindow(() => 288);
    expect(bubble.visibleBounds()).toBeNull();
    bubble.show();
    created[0]!.readyToShow?.();
    expect(bubble.visibleBounds()).toEqual(created[0]!.bounds);
    bubble.hide();
    expect(bubble.visibleBounds()).toBeNull();
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
