import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for backlog/bug-app-lost-from-app-switcher (ADR 0029). Both
 * recording panels join full-screen Spaces. Without `skipTransformProcessType`,
 * Electron gets there by hiding the Dock icon — which also removes Kaipu from
 * Cmd+Tab — and nothing put it back. They must be `panel`s that join the Space
 * without touching the process, like the capture panel, overlays and toast.
 */

const created: Array<{ options: Record<string, unknown>; window: FakeWindow }> = [];

class FakeWindow {
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setContentProtection = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  moveTop = vi.fn();
  setBounds = vi.fn();
  show = vi.fn();
  showInactive = vi.fn();
  hide = vi.fn();
  destroy = vi.fn();
  isVisible = () => false;
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  once = vi.fn();
  on = vi.fn();
  isDestroyed = () => false;
  webContents = { send: vi.fn() };
  constructor(options: Record<string, unknown>) {
    created.push({ options, window: this });
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
const { CameraBubbleWindow } = await import("./camera-bubble-window");
const { RecordingShadeWindow } = await import("./recording-shade-window");

const SHADE_DISPLAY = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
const SHADE_AREA = { x: 100, y: 50, width: 640, height: 360 };

const realPlatform = process.platform;

describe.each([
  ["control bar", () => new ControlBarWindow().show()],
  ["camera bubble", () => new CameraBubbleWindow().show()],
])("%s over a full-screen app (macOS)", (_name, open) => {
  beforeAll(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  });
  beforeEach(() => {
    created.length = 0;
  });

  it("is a floating panel that joins full-screen Spaces without transforming the process", () => {
    open();

    const [{ options, window }] = created;
    expect(options.type).toBe("panel");
    expect(options.fullscreenable).toBe(false);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  });
});

describe("the recording panels off macOS", () => {
  beforeAll(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  });
  beforeEach(() => {
    created.length = 0;
  });

  it("are plain windows: `panel` is a macOS-only window type", () => {
    new ControlBarWindow().show();
    new CameraBubbleWindow().show();
    expect(created).toHaveLength(2);
    for (const { options } of created) expect(options.type).toBeUndefined();
  });
});

describe("the recording shade", () => {
  beforeAll(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  });
  beforeEach(() => {
    created.length = 0;
  });

  it("is a panel that joins full-screen Spaces, one level below the bar and the bubble", () => {
    new RecordingShadeWindow().show(SHADE_DISPLAY, SHADE_AREA);

    const [{ options, window }] = created;
    expect(options.type).toBe("panel");
    // "status" is under the bar's and the bubble's "screen-saver": they are never dimmed.
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "status");
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  });

  it("covers the recorded display, never takes a click and never lands in the video", () => {
    new RecordingShadeWindow().show(SHADE_DISPLAY, SHADE_AREA);

    const [{ options, window }] = created;
    expect(options.focusable).toBe(false);
    expect(options.x).toBe(1512);
    expect(options.width).toBe(1512);
    expect(options.height).toBe(982);
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(window.setContentProtection).toHaveBeenCalledWith(true);
  });

  it("tells the renderer where the clear area is", () => {
    new RecordingShadeWindow().show(SHADE_DISPLAY, SHADE_AREA);

    const [{ window }] = created;
    const loaded = JSON.stringify([window.loadURL.mock.calls, window.loadFile.mock.calls]);
    expect(loaded).toContain("window=recording-shade");
    expect(loaded).toContain("rect=100,50,640,360");
  });

  it("is torn down on hide, and a second show replaces the first", () => {
    const shade = new RecordingShadeWindow();
    shade.show(SHADE_DISPLAY, SHADE_AREA);
    shade.show(SHADE_DISPLAY, { x: 0, y: 0, width: 800, height: 600 });
    expect(created[0].window.destroy).toHaveBeenCalled();
    shade.hide();
    expect(created[1].window.destroy).toHaveBeenCalled();
  });
});
