import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER, IPC_CHANNELS } from "@shared/types/ipc";

const mockState = vi.hoisted(() => ({
  userDataDir: "",
  ipcOn: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  ipcHandle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  screenOn: new Map<string, () => void>(),
  /** What AppKit would report: the process' real activation policy. */
  dockVisible: true,
  setActivationPolicy: vi.fn(),
  dockShow: vi.fn(),
  bubble: {
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    isVisible: vi.fn(() => false),
    anchorTo: vi.fn(),
    raise: vi.fn(),
    applySize: vi.fn(),
    preview: vi.fn((size: number) => size),
  },
  bar: { show: vi.fn(), hide: vi.fn(), sendTick: vi.fn(), reset: vi.fn(), raise: vi.fn() },
  shade: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
  shortcutRegister: vi.fn((_accelerator: string, _handler: () => void) => true),
  shortcutUnregister: vi.fn(),
  displays: [] as Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>,
  showSaveDialog: vi.fn(),
  getSources: vi.fn(
    async (): Promise<Array<{ id: string; name: string; display_id: string }>> => [],
  ),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? mockState.userDataDir : "/tmp"),
    setActivationPolicy: mockState.setActivationPolicy,
    dock: { show: mockState.dockShow, isVisible: () => mockState.dockVisible },
    setLoginItemSettings: vi.fn(),
    focus: vi.fn(),
  },
  ipcMain: {
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mockState.ipcOn.set(channel, fn);
    },
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mockState.ipcHandle.set(channel, fn);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getAllDisplays: () => mockState.displays,
    on: (event: string, fn: () => void) => {
      mockState.screenOn.set(event, fn);
    },
  },
  dialog: { showSaveDialog: mockState.showSaveDialog },
  desktopCapturer: { getSources: mockState.getSources },
  systemPreferences: { isTrustedAccessibilityClient: () => false },
  globalShortcut: {
    register: mockState.shortcutRegister,
    unregister: mockState.shortcutUnregister,
  },
}));

vi.mock("./camera-bubble-window", () => ({
  CameraBubbleWindow: class {
    show = mockState.bubble.show;
    hide = mockState.bubble.hide;
    destroy = mockState.bubble.destroy;
    isVisible = mockState.bubble.isVisible;
    anchorTo = mockState.bubble.anchorTo;
    raise = mockState.bubble.raise;
    applySize = mockState.bubble.applySize;
    preview = mockState.bubble.preview;
  },
}));

vi.mock("./recording-shade-window", () => ({
  RecordingShadeWindow: class {
    show = mockState.shade.show;
    hide = mockState.shade.hide;
    update = mockState.shade.update;
  },
}));

vi.mock("./control-bar-window", () => ({
  ControlBarWindow: class {
    show = mockState.bar.show;
    hide = mockState.bar.hide;
    sendTick = mockState.bar.sendTick;
    reset = mockState.bar.reset;
    raise = mockState.bar.raise;
  },
}));

const realPlatform = process.platform;

function fakeMainWindow() {
  return {
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
}

/**
 * Regression for backlog/bug-main-window-hides-on-blur: turning the camera on
 * re-asserts the Dock policy, and every re-assertion used to run
 * `app.dock.show()`, which on macOS orders the main window out and back in.
 * The user saw the app vanish right after pressing a toggle inside it.
 */
describe("recording hub — camera on keeps the main window visible", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    for (const fn of [
      mockState.setActivationPolicy,
      mockState.dockShow,
      ...Object.values(mockState.bubble),
      ...Object.values(mockState.bar),
      ...Object.values(mockState.shade),
    ]) {
      fn.mockReset();
    }
    mockState.bubble.isVisible.mockReturnValue(false);
    mockState.setActivationPolicy.mockImplementation((policy: string) => {
      mockState.dockVisible = policy === "regular";
    });
    mockState.dockVisible = true;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    vi.resetModules();
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("shows the bubble without hiding the main window or churning the activation policy", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    const hub = registerRecordingHub(() => mainWindow as never);
    // Startup applied the persisted policy once; from here on nothing changes it.
    const policyCalls = mockState.setActivationPolicy.mock.calls.length;
    const dockCalls = mockState.dockShow.mock.calls.length;

    hub.toggleRecordingSetting("isCameraEnabled");

    expect(mockState.bubble.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.hide).not.toHaveBeenCalled();
    expect(mockState.setActivationPolicy).toHaveBeenCalledTimes(policyCalls);
    expect(mockState.dockShow).toHaveBeenCalledTimes(dockCalls);
  });

  it("the same holds when the toggle arrives over IPC from a window", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    registerRecordingHub(() => mainWindow as never);
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();

    const update = mockState.ipcOn.get(IPC_CHANNELS.recordingSettingsUpdate);
    if (!update) throw new Error("recordingSettingsUpdate listener not registered");
    update({}, { isCameraEnabled: true });

    expect(mockState.bubble.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.hide).not.toHaveBeenCalled();
    expect(mockState.setActivationPolicy).not.toHaveBeenCalled();
    expect(mockState.dockShow).not.toHaveBeenCalled();
  });
});

/**
 * Regression for backlog/bug-app-lost-from-app-switcher (ADR 0029): the floating
 * panels used to hide the Dock icon as a side effect of joining full-screen
 * Spaces, and the policy setter — trusting only its cache — never put it back.
 * Even though the panels no longer transform the process, every re-assertion
 * point must restore the Dock when AppKit reports it gone.
 */
describe("recording hub — a Dock dropped by a floating panel comes back", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    for (const fn of [
      mockState.setActivationPolicy,
      mockState.dockShow,
      ...Object.values(mockState.bubble),
      ...Object.values(mockState.bar),
      ...Object.values(mockState.shade),
    ]) {
      fn.mockReset();
    }
    mockState.bubble.isVisible.mockReturnValue(false);
    mockState.setActivationPolicy.mockImplementation((policy: string) => {
      mockState.dockVisible = policy === "regular";
    });
    mockState.dockVisible = true;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    vi.resetModules();
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("stopping a recording restores the Dock the control bar dropped", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    registerRecordingHub(() => mainWindow as never);
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();
    // Stands in for Electron's default process transform on a window that joins
    // full-screen Spaces: the process becomes an accessory app behind our back.
    mockState.bar.show.mockImplementation(() => {
      mockState.dockVisible = false;
    });

    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart);
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop);
    if (!start || !stop) throw new Error("recording start/stop listeners not registered");

    start({}, { sourceId: "screen:1:0", sourceName: "Screen 1" });
    // Nothing changed when the recording started: the app was already regular.
    expect(mockState.setActivationPolicy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mockState.bar.show).toHaveBeenCalledTimes(1));
    expect(mockState.dockVisible).toBe(false);

    stop({});
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("regular");
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);
    expect(mockState.dockVisible).toBe(true);
    expect(mainWindow.show).toHaveBeenCalled();
  });

  it("an area recording shades the display outside it and keeps the bubble inside, until stop", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }, display];
    mockState.getSources.mockResolvedValue([
      { id: "screen:2:0", name: "Screen 2", display_id: "2" },
    ]);
    const area = {
      displayId: 2,
      rect: { x: 100, y: 50, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };
    await hub.selectArea(2, area.rect);

    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!;
    start({}, { sourceId: "screen:2:0", sourceName: "Area · 640 × 360", area });

    expect(mockState.shade.show).toHaveBeenCalledWith(display, area.rect, expect.any(Function));
    // The bar keeps clear of the area (design "Kaipu Record Modes"), anchored to it globally.
    await vi.waitFor(() =>
      expect(mockState.bar.show).toHaveBeenCalledWith("2", {
        includeInRecording: false,
        anchor: { x: 1612, y: 50, width: 640, height: 360 },
      }),
    );
    expect(mockState.bubble.anchorTo).toHaveBeenLastCalledWith({
      x: 1612,
      y: 50,
      width: 640,
      height: 360,
    });

    stop({});
    expect(mockState.shade.hide).toHaveBeenCalled();
    expect(mockState.bubble.anchorTo).toHaveBeenLastCalledWith(null);
  });

  it("draws the countdown on the region the overlay chose, and Esc cancels it", async () => {
    mockState.shortcutRegister.mockClear();
    mockState.shortcutUnregister.mockClear();
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    const hub = registerRecordingHub(() => mainWindow as never);
    const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
    mockState.displays = [display];
    const rect = { x: 100, y: 50, width: 640, height: 360 };
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;

    hub.prepareRegionCountdown(2, rect);
    phase({}, { phase: "counting", value: 3 });
    expect(mockState.shade.show).toHaveBeenLastCalledWith(display, rect, expect.any(Function), {
      phase: "countdown",
      value: 3,
    });
    expect(mockState.shortcutRegister).toHaveBeenCalledWith("Escape", expect.any(Function));

    // Esc sends the recorder the same Stop that cancels a pending start.
    const onEscape = mockState.shortcutRegister.mock.calls[0]![1];
    onEscape();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.recordingCommand, "stop");
    phase({}, { phase: "idle" });
    expect(mockState.shade.hide).toHaveBeenCalled();
    expect(mockState.shortcutUnregister).toHaveBeenCalledWith("Escape");
  });

  it("answers that the countdown is visible only once the region's shade has shown it", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const visible = mockState.ipcHandle.get(IPC_CHANNELS.recordingCountdownVisible)!;

    // No region: the Record page draws its own countdown, already on screen.
    expect(visible({})).toBeUndefined();

    hub.prepareRegionCountdown(2, { x: 100, y: 50, width: 640, height: 360 });
    let shown = false;
    const waiting = (visible({}) as Promise<void>).then(() => (shown = true));
    phase({}, { phase: "counting", value: 3 });
    await Promise.resolve();
    expect(shown).toBe(false);

    // The shade's ready-to-show callback.
    const onShown = mockState.shade.show.mock.lastCall![2] as () => void;
    onShown();
    await waiting;
    expect(shown).toBe(true);
    expect(visible({})).toBeUndefined();
  });

  it("opens the region's shade on 3 as soon as the region is prepared, before the first tick", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const display = { id: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
    mockState.displays = [display];
    const rect = { x: 100, y: 50, width: 640, height: 360 };
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const visible = mockState.ipcHandle.get(IPC_CHANNELS.recordingCountdownVisible)!;

    hub.prepareRegionCountdown(2, rect);
    expect(mockState.shade.show).toHaveBeenCalledTimes(1);
    expect(mockState.shade.show).toHaveBeenCalledWith(display, rect, expect.any(Function), {
      phase: "countdown",
      value: 3,
    });

    // The shade showed while the start request travelled: the recorder's wait is answered
    // at once, and its ticks only repaint the window already up.
    const onShown = mockState.shade.show.mock.lastCall![2] as () => void;
    onShown();
    expect(visible({})).toBeUndefined();
    phase({}, { phase: "counting", value: 3 });
    phase({}, { phase: "counting", value: 2 });
    expect(mockState.shade.show).toHaveBeenCalledTimes(1);
    expect(mockState.shade.update).toHaveBeenLastCalledWith({ phase: "countdown", value: 2 });
  });

  it("a tick reported while the shade still loads does not count as visible", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const visible = mockState.ipcHandle.get(IPC_CHANNELS.recordingCountdownVisible)!;

    hub.prepareRegionCountdown(2, null);
    let shown = false;
    const waiting = (visible({}) as Promise<void>).then(() => (shown = true));
    phase({}, { phase: "counting", value: 3 });
    await Promise.resolve();
    expect(shown).toBe(false);
    (mockState.shade.show.mock.lastCall![2] as () => void)();
    await waiting;
    expect(shown).toBe(true);
  });

  it("releases a recorder waiting on the countdown when the region is abandoned", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const visible = mockState.ipcHandle.get(IPC_CHANNELS.recordingCountdownVisible)!;

    hub.prepareRegionCountdown(2, { x: 100, y: 50, width: 640, height: 360 });
    const waiting = visible({}) as Promise<void>;
    phase({}, { phase: "counting", value: 3 });
    phase({}, { phase: "idle" });
    await expect(waiting).resolves.toBeUndefined();
  });

  it("reports a pending take to the tray: on while counting, off once it starts or is cancelled", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const onPendingChange = vi.fn();
    registerRecordingHub(() => fakeMainWindow() as never, undefined, onPendingChange);
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;

    // Any countdown counts, prepared region or not (the Record page's picker path).
    phase({}, { phase: "counting", value: 3 });
    phase({}, { phase: "counting", value: 2 });
    phase({}, { phase: "idle" });
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);

    phase({}, { phase: "counting", value: 1 });
    phase({}, { phase: "starting" });
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:1:0", sourceName: "Screen" },
    );
    expect(onPendingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("a countdown nobody prepared draws nothing, and junk reports are ignored", async () => {
    mockState.shortcutRegister.mockClear();
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    phase({}, { phase: "counting", value: 3 });
    phase({}, "junk");
    expect(mockState.shade.show).not.toHaveBeenCalled();
    expect(mockState.shortcutRegister).not.toHaveBeenCalled();
  });

  it("the take starting releases Esc and keeps the region's shade for the recording", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
    mockState.displays = [display];
    mockState.getSources.mockResolvedValue([
      { id: "screen:2:0", name: "Screen 2", display_id: "2" },
    ]);
    const rect = { x: 100, y: 50, width: 640, height: 360 };
    await hub.selectArea(2, rect);
    hub.prepareRegionCountdown(2, rect);
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    phase({}, { phase: "counting", value: 1 });
    phase({}, { phase: "starting" });
    expect(mockState.shade.update).toHaveBeenCalledWith({ phase: "countdown", value: null });

    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:2:0", sourceName: "Area" },
    );
    expect(mockState.shortcutUnregister).toHaveBeenCalledWith("Escape");
    // The recording shade on the same region: the window turns from countdown to recording.
    expect(mockState.shade.show).toHaveBeenLastCalledWith(display, rect, expect.any(Function));
  });

  describe("countdown length setting", () => {
    afterEach(async () => {
      const { updateAppSettings } = await import("../infrastructure/settings-store");
      updateAppSettings({ recordingCountdownSeconds: 3 });
    });

    async function setup(seconds: 0 | 3 | 5) {
      const { registerSettings, updateAppSettings } =
        await import("../infrastructure/settings-store");
      const { registerRecordingHub } = await import("./recording-hub");
      registerSettings();
      updateAppSettings({ recordingCountdownSeconds: seconds });
      const hub = registerRecordingHub(() => fakeMainWindow() as never);
      const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
      mockState.displays = [display];
      mockState.getSources.mockResolvedValue([
        { id: "screen:2:0", name: "Screen 2", display_id: "2" },
      ]);
      return { hub, display };
    }

    it("paints the configured length as the shade's first tick", async () => {
      const { hub, display } = await setup(5);
      const rect = { x: 100, y: 50, width: 640, height: 360 };

      hub.prepareRegionCountdown(2, rect);

      expect(mockState.shade.show).toHaveBeenCalledTimes(1);
      expect(mockState.shade.show).toHaveBeenCalledWith(display, rect, expect.any(Function), {
        phase: "countdown",
        value: 5,
      });
    });

    it("with 0 draws no countdown shade, does not make the recorder wait, and holds no Esc", async () => {
      mockState.shortcutRegister.mockClear();
      const { hub } = await setup(0);
      const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
      const visible = mockState.ipcHandle.get(IPC_CHANNELS.recordingCountdownVisible)!;

      hub.prepareRegionCountdown(2, { x: 100, y: 50, width: 640, height: 360 });
      // The recorder skips the countdown and reports acquiring straight away.
      phase({}, { phase: "starting" });

      expect(mockState.shade.show).not.toHaveBeenCalled();
      expect(mockState.shade.update).not.toHaveBeenCalled();
      expect(visible({})).toBeUndefined();
      expect(mockState.shortcutRegister).not.toHaveBeenCalled();
    });

    it("draws the countdown the recorder runs when its length disagrees with the region's", async () => {
      // Main read 0 when the region was prepared, but the recorder (its own copy of the
      // setting, not yet updated) counts 3: the countdown it runs must still be on screen.
      mockState.shortcutRegister.mockClear();
      const { hub, display } = await setup(0);
      const rect = { x: 100, y: 50, width: 640, height: 360 };
      const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
      const visible = mockState.ipcHandle.get(IPC_CHANNELS.recordingCountdownVisible)!;

      hub.prepareRegionCountdown(2, rect);
      phase({}, { phase: "counting", value: 3 });

      expect(mockState.shade.show).toHaveBeenCalledWith(display, rect, expect.any(Function), {
        phase: "countdown",
        value: 3,
      });
      // The recorder starts its clock only once that shade is on screen.
      const wait = visible({}) as Promise<void> | undefined;
      expect(wait).toBeInstanceOf(Promise);
      const onShown = mockState.shade.show.mock.calls[0]![2] as () => void;
      onShown();
      await expect(wait).resolves.toBeUndefined();
      expect(mockState.shortcutRegister).toHaveBeenCalledWith("Escape", expect.any(Function));
    });

    it("with 0 a Frame area still gets its shade and border when the take starts", async () => {
      const { hub, display } = await setup(0);
      const rect = { x: 100, y: 50, width: 640, height: 360 };
      await hub.selectArea(2, rect);
      hub.prepareRegionCountdown(2, rect);
      const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
      phase({}, { phase: "starting" });

      mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
        {},
        { sourceId: "screen:2:0", sourceName: "Area" },
      );

      // The only shade of the take: the recording one on the area, never a countdown dim.
      expect(mockState.shade.show).toHaveBeenCalledOnce();
      expect(mockState.shade.show).toHaveBeenCalledWith(display, rect, expect.any(Function));
    });

    it("with 0 a whole display gets its border when the take starts", async () => {
      const { hub, display } = await setup(0);
      await hub.selectArea(2, null);
      hub.prepareRegionCountdown(2, null);
      const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
      phase({}, { phase: "starting" });

      mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
        {},
        { sourceId: "screen:2:0", sourceName: "Screen 2" },
      );

      expect(mockState.shade.show).toHaveBeenCalledOnce();
      expect(mockState.shade.show).toHaveBeenCalledWith(display, null, expect.any(Function));
    });

    it("with 0 a start that fails before the take still brings the hidden app back", async () => {
      const { hub } = await setup(0);
      const reveal = vi.fn();
      hub.prepareRegionCountdown(2, null, reveal);
      const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;

      phase({}, { phase: "idle" });

      expect(reveal).toHaveBeenCalledOnce();
    });
  });

  it("reveals the hidden app when a prepared start never reaches the recorder", async () => {
    vi.useFakeTimers();
    try {
      const { registerSettings } = await import("../infrastructure/settings-store");
      const { registerRecordingHub, COUNTDOWN_REGION_TTL_MS } = await import("./recording-hub");
      registerSettings();
      const hub = registerRecordingHub(() => fakeMainWindow() as never);
      mockState.displays = [{ id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } }];
      const reveal = vi.fn();

      hub.prepareRegionCountdown(2, { x: 100, y: 50, width: 640, height: 360 }, reveal);
      vi.advanceTimersByTime(COUNTDOWN_REGION_TTL_MS - 1);
      expect(reveal).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(reveal).toHaveBeenCalledTimes(1);
      expect(mockState.shade.hide).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals the hidden app when the countdown is cancelled, and not once the take starts", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const reveal = vi.fn();

    hub.prepareRegionCountdown(2, null, reveal);
    phase({}, { phase: "counting", value: 3 });
    phase({}, { phase: "idle" });
    expect(reveal).toHaveBeenCalledTimes(1);

    const revealAgain = vi.fn();
    hub.prepareRegionCountdown(2, null, revealAgain);
    phase({}, { phase: "counting", value: 1 });
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:2:0", sourceName: "S" },
    );
    phase({}, { phase: "idle" });
    expect(revealAgain).not.toHaveBeenCalled();
  });

  it("a cancelled countdown brings the app back as a stop does: Dock re-asserted, app activated", async () => {
    const electron = await import("electron");
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const reveal = vi.fn();
    vi.mocked(electron.app.focus).mockClear();
    mockState.dockShow.mockClear();

    hub.prepareRegionCountdown(1, null, reveal);
    phase({}, { phase: "counting", value: 3 });
    // The user clicked into another app during 3-2-1 (the shade is click-through), and the
    // hidden window dropped the app from the Dock.
    mockState.dockVisible = false;
    phase({}, { phase: "idle" });

    expect(reveal).toHaveBeenCalledTimes(1);
    // Showing the window alone leaves it unfocused behind the other app.
    expect(electron.app.focus).toHaveBeenCalledWith({ steal: true });
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);
    expect(mockState.dockVisible).toBe(true);
  });

  it("a stop that lands before the source lookup resolves never brings the bar up", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    let resolve!: (sources: Array<{ id: string; name: string; display_id: string }>) => void;
    mockState.getSources.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!;

    start({}, { sourceId: "screen:1:0", sourceName: "S" });
    stop({});
    resolve([{ id: "screen:1:0", name: "S", display_id: "1" }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockState.bar.show).not.toHaveBeenCalled();
  });

  it("a take starting resets the bar to its neutral state before the bar can show", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    mockState.getSources.mockResolvedValue([{ id: "screen:1:0", name: "S", display_id: "1" }]);

    // The previous take left the hidden bar on "Saving…"; the next one must not show it.
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:1:0", sourceName: "S" },
    );
    expect(mockState.bar.reset).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mockState.bar.show).toHaveBeenCalledTimes(1));
    expect(mockState.bar.reset.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.bar.show.mock.invocationCallOrder[0],
    );
  });

  it("relays the recorder's ticks to the bar", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    const tick = { elapsedSeconds: 3, levels: [0, 0, 0, 0, 0], status: "recording" };

    mockState.ipcOn.get(IPC_CHANNELS.recordingReportTick)!({}, tick);

    expect(mockState.bar.sendTick).toHaveBeenCalledWith(tick);
  });

  it("a source lookup left over from a cancelled take never acts on the next take", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const display1 = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
    const display2 = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
    mockState.displays = [display1, display2];
    const sources = [
      { id: "screen:1:0", name: "Screen 1", display_id: "1" },
      { id: "screen:2:0", name: "Screen 2", display_id: "2" },
    ];
    // Take B's area is chosen first (that lists the sources), then the list goes stale.
    mockState.getSources.mockResolvedValue(sources);
    const rect = { x: 100, y: 50, width: 640, height: 360 };
    await hub.selectArea(2, rect);
    mockState.screenOn.get("display-added")!();
    let resolve!: (list: typeof sources) => void;
    mockState.getSources.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!;

    // Take A (the whole display 1) is cancelled while its display lookup still runs...
    start({}, { sourceId: "screen:1:0", sourceName: "Screen 1" });
    stop({});
    // ...and take B (an area of display 2) starts before that lookup comes back.
    start({}, { sourceId: "screen:2:0", sourceName: "Area" });
    expect(mockState.shade.show).toHaveBeenLastCalledWith(display2, rect, expect.any(Function));
    resolve(sources);
    await new Promise((r) => setTimeout(r, 0));

    // Only B's bar, and B's area shade is not replaced by A's full-display border.
    expect(mockState.bar.show).toHaveBeenCalledTimes(1);
    expect(mockState.bar.show).toHaveBeenCalledWith("2", expect.anything());
    expect(mockState.shade.show).toHaveBeenLastCalledWith(display2, rect, expect.any(Function));
  });

  it("a cursor track whose take was aborted while its display resolved never starts sampling", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    let resolve!: (list: Array<{ id: string; name: string; display_id: string }>) => void;
    mockState.getSources.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const trackStart = mockState.ipcHandle.get(IPC_CHANNELS.cursorTrackStart)!;
    const abort = mockState.ipcHandle.get(IPC_CHANNELS.recordingAbort)!;
    await create({}, "session-1");

    // The start failed (or was cancelled) fast: its abort lands before the lookup returns.
    const started = trackStart({}, "session-1", "screen:1:0") as Promise<{ enabled: boolean }>;
    await abort({}, "session-1");
    resolve([{ id: "screen:1:0", name: "S", display_id: "1" }]);

    // Nothing would ever finish or discard that tracker: it would sample, with the global
    // mouse hook on, until the app quits.
    await expect(started).resolves.toEqual({ enabled: false });
    // The same id from a reloaded recorder is a new session, tracked as usual.
    await create({}, "session-1");
    mockState.getSources.mockResolvedValue([{ id: "screen:1:0", name: "S", display_id: "1" }]);
    await expect(trackStart({}, "session-1", "screen:1:0")).resolves.toEqual({ enabled: true });
    await abort({}, "session-1");
  });

  it("starts the region's TTL only once a recreated main window has loaded", async () => {
    vi.useFakeTimers();
    try {
      const { registerSettings } = await import("../infrastructure/settings-store");
      const { registerRecordingHub, COUNTDOWN_REGION_TTL_MS } = await import("./recording-hub");
      registerSettings();
      let loaded: (() => void) | null = null;
      const loading = {
        ...fakeMainWindow(),
        webContents: {
          send: vi.fn(),
          isLoading: () => true,
          once: (_event: string, cb: () => void) => {
            loaded = cb;
          },
        },
      };
      const hub = registerRecordingHub(() => loading as never);
      mockState.displays = [{ id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } }];
      const reveal = vi.fn();

      hub.prepareRegionCountdown(2, null, reveal);
      vi.advanceTimersByTime(COUNTDOWN_REGION_TTL_MS * 3);
      expect(reveal).not.toHaveBeenCalled();
      loaded!();
      vi.advanceTimersByTime(COUNTDOWN_REGION_TTL_MS);
      expect(reveal).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pending take is busy: isPending and the broadcast say so until it starts", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    const hub = registerRecordingHub(() => mainWindow as never);
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const state = () =>
      mockState.ipcHandle.get(IPC_CHANNELS.recordingGetState)!({}) as { pending?: boolean };

    expect(hub.isPending()).toBe(false);
    phase({}, { phase: "counting", value: 3 });
    expect(hub.isPending()).toBe(true);
    expect(state().pending).toBe(true);
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:1:0", sourceName: "S" },
    );
    expect(hub.isPending()).toBe(false);
    expect(state().pending).toBeUndefined();
  });

  it("a whole-display countdown turns into the border at once, even when the source lookup fails", async () => {
    const display = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
    mockState.displays = [display];
    mockState.getSources.mockRejectedValue(new Error("no sources"));
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;

    hub.prepareRegionCountdown(1, null);
    phase({}, { phase: "counting", value: 1 });
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:1:0", sourceName: "S" },
    );
    // Synchronously: the recording phase (no countdown state) on the same display.
    expect(mockState.shade.show).toHaveBeenLastCalledWith(display, null, expect.any(Function));
    await vi.waitFor(() => expect(mockState.bar.show).toHaveBeenCalled());
    expect(mockState.shade.hide).not.toHaveBeenCalled();
  });

  it("a full-display recording gets the border around the display and leaves the bubble where it was", async () => {
    const display = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
    mockState.displays = [display];
    mockState.getSources.mockResolvedValue([
      { id: "screen:1:0", name: "Screen 1", display_id: "1" },
    ]);
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);

    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:1:0", sourceName: "Screen 1" },
    );
    await vi.waitFor(() =>
      expect(mockState.shade.show).toHaveBeenCalledWith(display, null, expect.any(Function)),
    );
    expect(mockState.bar.show).toHaveBeenCalledWith("1", {
      includeInRecording: false,
      anchor: null,
    });
    expect(mockState.bubble.anchorTo).not.toHaveBeenCalled();
  });

  it("a full-display recording shows no shade before its display resolves", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);

    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      {
        sourceId: "screen:1:0",
        sourceName: "Screen 1",
      },
    );

    expect(mockState.shade.show).not.toHaveBeenCalled();
    expect(mockState.bubble.anchorTo).not.toHaveBeenCalled();
  });

  it("turning the camera on restores the Dock the bubble dropped, without hiding the main window", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    const hub = registerRecordingHub(() => mainWindow as never);
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();
    mockState.bubble.show.mockImplementation(() => {
      mockState.dockVisible = false;
    });

    hub.toggleRecordingSetting("isCameraEnabled");

    expect(mockState.bubble.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.hide).not.toHaveBeenCalled();
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("regular");
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);
    expect(mockState.dockVisible).toBe(true);
  });
});

/**
 * REC-B6: a finalize that cannot reach the vault must keep the take and tell the
 * renderer which toast to show, instead of a generic "couldn't save".
 */
describe("recording hub — finalize into an unreachable vault", () => {
  async function finalizeWithDialog(dialogResult: { canceled: boolean; filePath?: string }) {
    // A vault path under a regular file: mkdir always fails.
    const blocker = join(mockState.userDataDir, "blocker");
    await writeFile(blocker, "x");
    await writeFile(
      join(mockState.userDataDir, "preferences.json"),
      JSON.stringify({ vaultDirectory: join(blocker, "vault") }),
    );
    mockState.showSaveDialog.mockResolvedValue(dialogResult);
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => null);
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate);
    const finalize = mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize);
    if (!create || !finalize) throw new Error("recording handlers not registered");
    await create({}, "s1");
    return finalize({}, "s1", { title: "t", durationSeconds: 1, durationMs: 1000 });
  }

  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    mockState.showSaveDialog.mockReset();
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("tags the rejection with the kept marker when the user cancels the dialog", async () => {
    await expect(finalizeWithDialog({ canceled: true })).rejects.toThrow(FINALIZE_KEPT_MARKER);
  });

  it("moves the take where the user chose and tags the rejection with the elsewhere marker", async () => {
    const filePath = join(mockState.userDataDir, "chosen.mp4");
    await expect(finalizeWithDialog({ canceled: false, filePath })).rejects.toThrow(
      FINALIZE_ELSEWHERE_MARKER,
    );
    expect(await readFile(filePath)).toHaveLength(0);
  });
});

describe("recording hub — choosing an area or a display on the overlay", () => {
  const display = {
    id: 2,
    bounds: { x: 1512, y: 0, width: 1512, height: 982 },
  };

  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }, display];
    mockState.getSources.mockReset();
    for (const fn of [...Object.values(mockState.shade), ...Object.values(mockState.bubble)]) {
      fn.mockReset();
    }
    mockState.getSources.mockResolvedValue([
      { id: "screen:1:0", name: "Screen 1", display_id: "1" },
      { id: "screen:2:0", name: "Screen 2", display_id: "2" },
    ]);
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  async function hub() {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const handle = registerRecordingHub(() => fakeMainWindow() as never);
    const settings = () =>
      mockState.ipcHandle.get(IPC_CHANNELS.recordingSettingsGet)!({}) as Record<string, unknown>;
    return { handle, settings };
  }

  it("an area becomes that display's screen source plus the area", async () => {
    const { handle, settings } = await hub();
    const rect = { x: 100.4, y: 50, width: 640, height: 360.6 };

    expect(await handle.selectArea(2, rect)).toBe(true);

    expect(settings().selectedSource).toEqual({
      id: "screen:2:0",
      name: "Area · 640 × 361",
      type: "screen",
    });
    expect(settings().area).toEqual({
      displayId: 2,
      rect: { x: 100, y: 50, width: 640, height: 361 },
      displaySize: { width: 1512, height: 982 },
    });
  });

  it("keeps the overlay's locked ratio on the area, for the take's capture metadata", async () => {
    const { handle, settings } = await hub();
    expect(await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 }, "16:9")).toBe(true);
    expect(settings().area).toMatchObject({ displayId: 2, ratio: "16:9" });
  });

  it("a whole display becomes its screen source with no area", async () => {
    const { handle, settings } = await hub();
    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });

    expect(await handle.selectArea(1, null)).toBe(true);

    expect(settings().selectedSource).toEqual({
      id: "screen:1:0",
      name: "Screen 1",
      type: "screen",
    });
    expect(settings().area).toBeNull();
  });

  it("a display that is gone, or has no screen source, changes nothing", async () => {
    const { handle, settings } = await hub();
    const before = { ...settings() };

    expect(await handle.selectArea(9, null)).toBe(false);
    mockState.getSources.mockResolvedValue([]);
    expect(await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 })).toBe(false);

    expect(settings()).toEqual(before);
  });

  it("never changes the target of a recording in progress", async () => {
    const { handle, settings } = await hub();
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:1:0", sourceName: "Screen 1" },
    );

    expect(await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 })).toBe(false);
    expect(settings().area).toBeNull();
  });

  it("a settings patch from a window can clear the area but never set one", async () => {
    const { handle, settings } = await hub();
    const update = mockState.ipcOn.get(IPC_CHANNELS.recordingSettingsUpdate)!;

    update({}, { area: { displayId: 2, rect: { x: 0, y: 0, width: 640, height: 360 } } });
    expect(settings().area).toBeNull();

    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });
    update({}, { area: { displayId: 1, rect: { x: 0, y: 0, width: 640, height: 360 } } });
    expect(settings().area).toMatchObject({ displayId: 2 });

    update({}, { area: null });
    expect(settings().area).toBeNull();
  });

  it("a window that changes the source drops the area chosen for the old one", async () => {
    const { handle, settings } = await hub();
    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });
    const update = mockState.ipcOn.get(IPC_CHANNELS.recordingSettingsUpdate)!;

    update({}, { isMicrophoneEnabled: false });
    expect(settings().area).not.toBeNull();

    update({}, { selectedSource: { id: "window:7:0", name: "Editor", type: "window" } });
    expect(settings().area).toBeNull();
  });

  it("a recording start shades the area main chose, not one the renderer sends", async () => {
    const { handle } = await hub();
    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!;
    const forged = {
      displayId: 1,
      rect: { x: 0, y: 0, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };

    start({}, { sourceId: "screen:2:0", sourceName: "Screen 2", area: forged });
    expect(mockState.shade.show).not.toHaveBeenCalled();
    stop({});

    await handle.selectArea(2, { x: 100, y: 50, width: 640, height: 360 });
    start({}, { sourceId: "screen:2:0", sourceName: "Area", area: forged });
    expect(mockState.shade.show).toHaveBeenCalledWith(
      display,
      { x: 100, y: 50, width: 640, height: 360 },
      expect.any(Function),
    );
  });

  it("a display unplugged or resized after its area was chosen drops the area and its source", async () => {
    const { handle, settings } = await hub();
    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });
    const metricsChanged = mockState.screenOn.get("display-metrics-changed")!;

    // Same size (a work-area or position change): the area still fits.
    metricsChanged();
    expect(settings().area).not.toBeNull();

    mockState.displays = [
      mockState.displays[0],
      { id: 2, bounds: { x: 1512, y: 0, width: 1280, height: 800 } },
    ];
    metricsChanged();
    expect(settings().area).toBeNull();
    expect(settings().selectedSource).toBeNull();

    mockState.displays = [mockState.displays[0], display];
    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });
    mockState.displays = [mockState.displays[0]];
    mockState.screenOn.get("display-removed")!();
    expect(settings().area).toBeNull();
  });

  it("lists the screen sources once: a prefetch at overlay open serves the pick", async () => {
    const { handle, settings } = await hub();
    handle.prefetchScreenSources();
    handle.prefetchScreenSources();
    expect(await handle.selectArea(2, null)).toBe(true);
    expect(await handle.selectArea(1, null)).toBe(true);
    expect(mockState.getSources).toHaveBeenCalledTimes(1);
    expect(settings().selectedSource).toMatchObject({ id: "screen:1:0" });
  });

  it("lists the screen sources again after a display change", async () => {
    const { handle } = await hub();
    await handle.selectArea(2, null);
    mockState.screenOn.get("display-added")!();
    await handle.selectArea(2, null);
    mockState.screenOn.get("display-metrics-changed")!();
    await handle.selectArea(2, null);
    expect(mockState.getSources).toHaveBeenCalledTimes(3);
  });

  it("a display change during a take waits for stop before dropping the area", async () => {
    const { handle, settings } = await hub();
    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      { sourceId: "screen:2:0", sourceName: "Area" },
    );

    mockState.displays = [mockState.displays[0]];
    mockState.screenOn.get("display-removed")!();
    expect(settings().area).not.toBeNull();

    mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!({});
    expect(settings().area).toBeNull();
  });

  it("stop moves and shows the bubble only after an area take, never over a screenshot", async () => {
    const { handle } = await hub();
    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!;
    mockState.ipcOn.get(IPC_CHANNELS.recordingSettingsUpdate)!({}, { isCameraEnabled: true });
    mockState.bubble.show.mockClear();

    start({}, { sourceId: "screen:1:0", sourceName: "Screen 1" });
    stop({});
    expect(mockState.bubble.anchorTo).not.toHaveBeenCalled();
    expect(mockState.bubble.show).not.toHaveBeenCalled();

    await handle.selectArea(2, { x: 0, y: 0, width: 640, height: 360 });
    start({}, { sourceId: "screen:2:0", sourceName: "Area" });
    mockState.bubble.isVisible.mockReturnValue(true);
    handle.hideCameraBubbleForCapture();
    stop({});
    expect(mockState.bubble.anchorTo).toHaveBeenLastCalledWith(null);
    expect(mockState.bubble.show).not.toHaveBeenCalled();
  });

  it("a forced reset removes a shade even when no take is active", async () => {
    const { handle } = await hub();
    handle.forceReset();
    expect(mockState.shade.hide).toHaveBeenCalled();
  });

  it("a window closed during a countdown ends the pending take: not busy, Esc freed, shade gone", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    mockState.shortcutUnregister.mockClear();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const reveal = vi.fn();

    hub.prepareRegionCountdown(2, { x: 10, y: 10, width: 300, height: 200 }, reveal);
    phase({}, { phase: "counting", value: 2 });
    expect(hub.isPending()).toBe(true);

    // The window is closed: no reveal (the user closed it), but the take must be released.
    hub.forceReset();
    expect(hub.isPending()).toBe(false);
    expect(mockState.shortcutUnregister).toHaveBeenCalledWith("Escape");
    expect(mockState.shade.hide).toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it("a forced reset that reveals brings the app back from a countdown it abandons", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    const phase = mockState.ipcOn.get(IPC_CHANNELS.recordingRecorderPhase)!;
    const reveal = vi.fn();

    hub.prepareRegionCountdown(2, null, reveal);
    phase({}, { phase: "counting", value: 2 });
    // The renderer died: the app was hidden for this countdown and must come back.
    hub.forceReset({ revealAbandoned: true });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(hub.isPending()).toBe(false);
  });

  it("an area smaller than the minimum is refused", async () => {
    const { handle } = await hub();
    expect(await handle.selectArea(2, { x: 0, y: 0, width: 63, height: 400 })).toBe(false);
  });
});

describe("recording hub — camera bubble size", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    mockState.bubble.applySize.mockReset();
    mockState.bubble.preview.mockReset();
    mockState.bubble.preview.mockImplementation((size: number) => size);
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  async function setup(): Promise<void> {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
  }

  it("re-places the bubble when its persisted size changes, and only then", async () => {
    await setup();
    const update = mockState.ipcHandle.get(IPC_CHANNELS.updateSettings)!;
    update({}, { cameraBubble: { shape: "rounded", size: 240, deviceId: null } });
    expect(mockState.bubble.applySize).not.toHaveBeenCalled();
    update({}, { cameraBubble: { shape: "rounded", size: 360, deviceId: null } });
    expect(mockState.bubble.applySize).toHaveBeenCalledOnce();
  });

  it("previews a grip drag and answers the applied size", async () => {
    await setup();
    mockState.bubble.preview.mockReturnValue(200);
    const preview = mockState.ipcHandle.get(IPC_CHANNELS.cameraBubblePreviewSize)!;
    expect(preview({}, 300)).toBe(200);
    expect(mockState.bubble.preview).toHaveBeenCalledWith(300);
  });
});
