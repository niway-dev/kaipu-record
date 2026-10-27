import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The camera bubble is recorded as part of the screen, so during an area recording it must
 * sit inside the area or not show at all (ADR 0030, spec decision 6).
 */

const created: FakeWindow[] = [];
let lastOptions: Record<string, unknown> | null = null;

class FakeWindow {
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  bounds = { x: 0, y: 0, width: 288, height: 288 };
  setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
    this.bounds = bounds;
  });
  getBounds = () => this.bounds;
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
  constructor(options: Record<string, unknown>) {
    lastOptions = options;
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
const TOO_SMALL = { x: 0, y: 0, width: 200, height: 200 };

describe("CameraBubbleWindow.anchorTo", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("moves a shown bubble inside an area that can hold it", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    bubble.anchorTo(FITS);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 1644,
      y: 90,
      width: 288,
      height: 288,
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
      x: 32,
      y: 580,
      width: 288,
      height: 288,
    });
  });
});

describe("CameraBubbleWindow size", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("is never movable by the OS", () => {
    const bubble = new CameraBubbleWindow();
    bubble.show();
    expect(created[0]).toBeDefined();
    expect(lastOptions?.movable).toBe(false);
    expect(lastOptions?.resizable).toBe(false);
  });

  it("re-places a showing bubble from its corner when the persisted size changes", () => {
    let size = 240;
    const bubble = new CameraBubbleWindow(() => size);
    bubble.show();
    bubble.anchorTo({ x: 0, y: 0, width: 1440, height: 900 });
    size = 360;
    bubble.applySize();
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 32,
      y: 460,
      width: 408,
      height: 408,
    });
  });

  it("previews a grip drag clamped to the area, and reports the size applied", () => {
    const bubble = new CameraBubbleWindow(() => 240);
    bubble.show();
    bubble.anchorTo(FITS); // 360 tall: room for a 248 px bubble
    expect(bubble.preview(480)).toBe(248);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 1644,
      y: 82,
      width: 296,
      height: 296,
    });
    expect(bubble.preview(10)).toBe(120);
  });

  it("drops the preview once the settings apply", () => {
    let size = 240;
    const bubble = new CameraBubbleWindow(() => size);
    bubble.show();
    bubble.preview(300);
    size = 160;
    bubble.applySize();
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 32,
      y: 660,
      width: 208,
      height: 208,
    });
  });
});

describe("CameraBubbleWindow drag-to-move", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("moves the bubble by the pointer's offset since the press", () => {
    const bubble = new CameraBubbleWindow(() => 240);
    bubble.show();
    created[0].readyToShow?.(); // at the display's corner: x 32, y 580
    bubble.beginMove();
    bubble.moveBy(100, -50);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 132,
      y: 530,
      width: 288,
      height: 288,
    });
    // Offsets are from the press, not from the previous step.
    bubble.moveBy(200, -60);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 232,
      y: 520,
      width: 288,
      height: 288,
    });
  });

  it("ignores a move without a press", () => {
    const bubble = new CameraBubbleWindow(() => 240);
    bubble.show();
    created[0].readyToShow?.();
    created[0].setBounds.mockClear();
    bubble.moveBy(100, 100);
    expect(created[0].setBounds).not.toHaveBeenCalled();
  });

  it("keeps the bubble inside the recorded area", () => {
    const bubble = new CameraBubbleWindow(() => 240);
    bubble.show();
    bubble.anchorTo(FITS); // window at x 1644, y 90 in a 640 x 360 area at (1612, 50)
    bubble.beginMove();
    bubble.moveBy(5000, -5000);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 1612 + 640 - 288,
      y: 50,
      width: 288,
      height: 288,
    });
  });

  it("grows from where it was dropped when the size changes", () => {
    let size = 240;
    const bubble = new CameraBubbleWindow(() => size);
    bubble.show();
    created[0].readyToShow?.();
    bubble.beginMove();
    bubble.moveBy(400, -200); // bottom-left corner at (432, 668)
    size = 360;
    bubble.applySize();
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 432,
      y: 668 - 408,
      width: 408,
      height: 408,
    });
  });

  it("starts each area recording at the area's corner, and returns to the dropped spot after", () => {
    const bubble = new CameraBubbleWindow(() => 240);
    bubble.show();
    created[0].readyToShow?.();
    bubble.beginMove();
    bubble.moveBy(400, -200);
    bubble.anchorTo(FITS);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 1644,
      y: 90,
      width: 288,
      height: 288,
    });
    bubble.anchorTo(null);
    expect(created[0].setBounds).toHaveBeenLastCalledWith({
      x: 432,
      y: 380,
      width: 288,
      height: 288,
    });
  });
});
