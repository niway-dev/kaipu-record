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
 * The bubble is excluded from the screen capture from creation (ADR 0037): its face is in the
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

  it("applyProtection brings an existing window in line with the rule, only on a change", () => {
    let protect = true;
    const bubble = new CameraBubbleWindow(undefined, () => protect);
    bubble.applyProtection(); // no window yet: nothing to do
    bubble.show();
    const win = created[0]!;
    bubble.applyProtection();
    expect(win.setContentProtection.mock.calls).toEqual([[true]]);
    // The take's webcam file ended mid-take: the bubble comes back into the capture.
    protect = false;
    bubble.applyProtection();
    bubble.applyProtection();
    expect(win.setContentProtection.mock.calls).toEqual([[true], [false]]);
    // The take ended: protected again before the next take's capture starts.
    protect = true;
    bubble.applyProtection();
    expect(win.setContentProtection.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("a window created unprotected is protected by applyProtection once the rule allows it", () => {
    let protect = false;
    const bubble = new CameraBubbleWindow(undefined, () => protect);
    bubble.show();
    protect = true;
    bubble.applyProtection();
    expect(created[0]!.setContentProtection.mock.calls).toEqual([[true]]);
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

/**
 * A camera turned off during a take that records a webcam file parks the bubble: the running
 * screen capture leaves out the windows that were on screen when it started, so turning the
 * camera on again must show that same window, not a new one (ADR 0037).
 */
describe("CameraBubbleWindow.park", () => {
  it("hides the window and keeps it, with its protection", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    const win = created[0]!;
    win.readyToShow?.();
    bubble.park();
    expect(win.hide).toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
    expect(win.setContentProtection.mock.calls).toEqual([[true]]);
    expect(bubble.isParked()).toBe(true);
    expect(bubble.isVisible()).toBe(false);
  });

  it("show brings back the same window, still protected", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    created[0]!.readyToShow?.();
    bubble.park();
    bubble.show();
    expect(created).toHaveLength(1);
    expect(created[0]!.showInactive).toHaveBeenCalledTimes(2);
    expect(created[0]!.setContentProtection.mock.calls).toEqual([[true]]);
    expect(bubble.isParked()).toBe(false);
  });

  it("a window parked before it was ready stays hidden when it becomes ready", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    bubble.park();
    created[0]!.readyToShow?.();
    expect(created[0]!.showInactive).not.toHaveBeenCalled();
  });

  it("does nothing without a window", () => {
    const bubble = new CameraBubbleWindow();
    bubble.park();
    expect(bubble.isParked()).toBe(false);
  });

  it("destroy releases a parked window", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    bubble.park();
    bubble.destroy();
    expect(created[0]!.destroy).toHaveBeenCalled();
    expect(bubble.isParked()).toBe(false);
  });

  it("placedBounds is where a parked bubble was; visibleBounds stays null for it", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    created[0]!.readyToShow?.();
    const shown = bubble.visibleBounds();
    expect(bubble.placedBounds()).toEqual(shown);
    bubble.park();
    expect(bubble.visibleBounds()).toBeNull();
    expect(bubble.placedBounds()).toEqual(shown);
  });
});

/**
 * The webcam file ended mid-take with the bubble on screen and protected: the face must be in
 * the screen from there on, and a running capture is known to record a new window (ADR 0037).
 */
describe("CameraBubbleWindow.replace", () => {
  it("creates a new window where the old one was, its protection decided again", () => {
    let protect = true;
    const bubble = new CameraBubbleWindow(undefined, () => protect);
    bubble.show();
    const old = created[0]!;
    old.readyToShow?.();
    old.bounds = { x: 500, y: 300, width: 288, height: 288 };
    expect(bubble.isProtected()).toBe(true);
    protect = false;
    bubble.replace();
    expect(old.destroy).toHaveBeenCalledOnce();
    const next = created[1]!;
    expect(next.setContentProtection).not.toHaveBeenCalled();
    expect(bubble.isProtected()).toBe(false);
    next.readyToShow?.();
    expect(next.showInactive).toHaveBeenCalledOnce();
    expect(next.bounds.x).toBe(500);
    expect(next.bounds.y + next.bounds.height).toBe(588);
  });

  it("without show, the next show() creates the new window at the same place", () => {
    const bubble = new CameraBubbleWindow(undefined, () => false);
    bubble.show();
    created[0]!.readyToShow?.();
    created[0]!.bounds = { x: 400, y: 200, width: 288, height: 288 };
    bubble.replace(false);
    expect(created).toHaveLength(1);
    bubble.show();
    created[1]!.readyToShow?.();
    expect(created[1]!.bounds.x).toBe(400);
    expect(created[1]!.bounds.y + created[1]!.bounds.height).toBe(488);
  });

  it("does nothing without a window", () => {
    const bubble = new CameraBubbleWindow();
    bubble.replace();
    expect(created).toHaveLength(0);
    expect(bubble.isProtected()).toBe(false);
  });
});
