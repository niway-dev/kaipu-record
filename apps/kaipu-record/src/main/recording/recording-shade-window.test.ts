import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: FakeWindow[] = [];

class FakeWindow {
  private readyToShow: (() => void) | null = null;
  private closed: (() => void) | null = null;
  private destroyed = false;
  /** The order of everything that touched the window, to pin "reset before show". */
  log: string[] = [];
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setContentProtection = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  setBounds = vi.fn((bounds: unknown) => this.log.push(`bounds ${JSON.stringify(bounds)}`));
  showInactive = vi.fn(() => this.log.push("show"));
  hide = vi.fn(() => this.log.push("hide"));
  destroy = vi.fn(() => {
    this.destroyed = true;
    this.closed?.();
  });
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  isDestroyed = () => this.destroyed;
  once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready-to-show") this.readyToShow = callback;
  });
  on = vi.fn((event: string, callback: () => void) => {
    if (event === "closed") this.closed = callback;
  });
  webContents = {
    send: vi.fn((_channel: string, view: unknown) => this.log.push(`send ${JSON.stringify(view)}`)),
  };
  constructor(public options: Record<string, unknown>) {
    created.push(this);
  }
  paint(): void {
    this.readyToShow?.();
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { RecordingShadeWindow } = await import("./recording-shade-window");
const { beginRecordTiming, endRecordTiming } = await import("./record-timing");

const DISPLAY = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
const OTHER = { id: 3, bounds: { x: 0, y: 982, width: 1920, height: 1080 } };
const AREA = { x: 100, y: 50, width: 640, height: 360 };
const COUNTDOWN = { phase: "countdown", value: 3 } as const;

const IDLE = { phase: "idle", rect: null };
const sent = (window: FakeWindow) =>
  window.webContents.send.mock.calls.map((call) => call[1] as Record<string, unknown>);

beforeEach(() => {
  created.length = 0;
});

describe("the recording shade: preloaded and reused", () => {
  it("prewarm loads one hidden window, idle, and shows nothing", () => {
    const shade = new RecordingShadeWindow();
    shade.prewarm();
    shade.prewarm();

    expect(created).toHaveLength(1);
    created[0]!.paint();
    expect(created[0]!.showInactive).not.toHaveBeenCalled();
    expect(created[0]!.options.show).toBe(false);
    // Hidden windows keep running: a throttled one would answer the first show late.
    expect(created[0]!.options.webPreferences).toMatchObject({ backgroundThrottling: false });
    expect(created[0]!.setContentProtection).toHaveBeenCalledWith(true);
    expect(created[0]!.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  });

  it("the loaded query carries no region or phase: those travel as state", () => {
    const shade = new RecordingShadeWindow();
    shade.show(DISPLAY, AREA, undefined, COUNTDOWN);
    const loaded = JSON.stringify([
      created[0]!.loadURL.mock.calls,
      created[0]!.loadFile.mock.calls,
    ]);
    expect(loaded).toContain("window=recording-shade");
    expect(loaded).not.toContain("rect=");
    expect(loaded).not.toContain("phase=");
  });

  it("shows a painted spare at once, with no new window and no new load", () => {
    const shade = new RecordingShadeWindow();
    shade.prewarm();
    created[0]!.paint();
    const onShown = vi.fn();

    shade.show(DISPLAY, AREA, onShown, COUNTDOWN);

    expect(created).toHaveLength(1);
    expect(created[0]!.loadFile).toHaveBeenCalledTimes(1);
    expect(created[0]!.showInactive).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(sent(created[0]!).at(-1)).toEqual({ ...COUNTDOWN, rect: AREA });
    expect(created[0]!.setBounds).toHaveBeenCalledWith(DISPLAY.bounds);
  });

  it("a spare still loading shows when it paints, with the latest state", () => {
    const shade = new RecordingShadeWindow();
    shade.prewarm();
    const onShown = vi.fn();
    shade.show(DISPLAY, AREA, onShown, COUNTDOWN);
    expect(created[0]!.showInactive).not.toHaveBeenCalled();
    shade.update({ phase: "countdown", value: 2 });

    created[0]!.paint();

    expect(created[0]!.showInactive).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledTimes(1);
    expect(sent(created[0]!).at(-1)).toEqual({ phase: "countdown", value: 2, rect: AREA });
  });

  it("a countdown shade becomes the recording shade in place when the region is the same", () => {
    const shade = new RecordingShadeWindow();
    shade.show(DISPLAY, AREA, undefined, COUNTDOWN);
    created[0]!.paint();
    shade.show(DISPLAY, AREA);

    expect(created).toHaveLength(1);
    expect(created[0]!.showInactive).toHaveBeenCalledTimes(1);
    expect(sent(created[0]!).at(-1)).toEqual({ phase: "recording", rect: AREA });
  });

  it("hide keeps the window and resets it while it is off screen", () => {
    const shade = new RecordingShadeWindow();
    shade.show(DISPLAY, AREA, undefined, COUNTDOWN);
    created[0]!.paint();

    shade.hide();

    expect(created[0]!.destroy).not.toHaveBeenCalled();
    expect(created[0]!.hide).toHaveBeenCalledTimes(1);
    expect(sent(created[0]!).at(-1)).toEqual(IDLE);
    // Hidden first, then neutral: the window never paints the neutral state on screen.
    const log = created[0]!.log;
    expect(log.lastIndexOf("hide")).toBeLessThan(log.lastIndexOf(`send ${JSON.stringify(IDLE)}`));
  });

  it("a reused shade never shows the previous take's state", () => {
    const shade = new RecordingShadeWindow();
    shade.show(DISPLAY, AREA, undefined, { phase: "recording" });
    created[0]!.paint();
    shade.hide();

    shade.show(OTHER, null, undefined, COUNTDOWN);

    expect(created).toHaveLength(1);
    const log = created[0]!.log;
    const before = log.slice(0, log.lastIndexOf("show"));
    // Moved to its display and told the new state before it is put back on screen.
    expect(before.at(-1)).toBe(`send ${JSON.stringify({ ...COUNTDOWN, rect: null })}`);
    expect(before).toContain(`bounds ${JSON.stringify(OTHER.bounds)}`);
  });

  it("show then hide before the page painted never shows it afterwards", () => {
    const shade = new RecordingShadeWindow();
    shade.prewarm();
    shade.show(DISPLAY, AREA, undefined, COUNTDOWN);
    shade.hide();

    created[0]!.paint();

    expect(created[0]!.showInactive).not.toHaveBeenCalled();
  });

  it("a different region while shown replaces what is painted without a new window", () => {
    const shade = new RecordingShadeWindow();
    shade.show(DISPLAY, AREA, undefined, COUNTDOWN);
    created[0]!.paint();
    shade.show(DISPLAY, { x: 0, y: 0, width: 800, height: 600 });

    expect(created).toHaveLength(1);
    expect(sent(created[0]!).at(-1)).toEqual({
      phase: "recording",
      rect: { x: 0, y: 0, width: 800, height: 600 },
    });
  });

  it("loads a new window when its page is gone (crash, closed)", () => {
    const shade = new RecordingShadeWindow();
    shade.prewarm();
    created[0]!.destroy();

    shade.show(DISPLAY, AREA, undefined, COUNTDOWN);

    expect(created).toHaveLength(2);
  });

  describe("[record-timing] marks", () => {
    let info: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      info = vi.spyOn(console, "info").mockImplementation(() => {});
      beginRecordTiming("start clicked");
    });
    afterEach(() => {
      endRecordTiming("done");
      info.mockRestore();
    });
    const lines = () => info.mock.calls.map((call) => String(call[0]));

    it("says a painted spare was reused", () => {
      const shade = new RecordingShadeWindow();
      shade.prewarm();
      created[0]!.paint();
      shade.show(DISPLAY, AREA, undefined, COUNTDOWN);
      expect(lines().some((line) => line.includes("countdown shade reused"))).toBe(true);
    });

    it("says it loaded one when none was ready", () => {
      new RecordingShadeWindow().show(DISPLAY, AREA, undefined, COUNTDOWN);
      expect(lines().some((line) => line.includes("countdown shade loaded fresh"))).toBe(true);
    });
  });
});
