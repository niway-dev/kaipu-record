import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FINALIZE_ELSEWHERE_MARKER,
  FINALIZE_KEPT_MARKER,
  IPC_CHANNELS,
  WEBCAM_TRACK_UNSUPPORTED_MARKER,
} from "@shared/types/ipc";

const mockState = vi.hoisted(() => ({
  userDataDir: "",
  /** What `os.release()` reports: a Windows build number decides whether capture can exclude a window. */
  osRelease: "24.0.0",
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
    visibleBounds: vi.fn(
      () => null as null | { x: number; y: number; width: number; height: number },
    ),
    anchorTo: vi.fn(),
    raise: vi.fn(),
    applySize: vi.fn(),
    preview: vi.fn((size: number) => size),
    applyProtection: vi.fn(),
  },
  /** The protection rule the hub built the bubble with. */
  bubbleProtect: null as null | (() => boolean),
  bar: { show: vi.fn(), hide: vi.fn(), sendTick: vi.fn(), reset: vi.fn(), raise: vi.fn() },
  shade: { show: vi.fn(), hide: vi.fn(), update: vi.fn(), prewarm: vi.fn() },
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

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  release: () => mockState.osRelease,
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

// The hub resolves the take's folder through the workspace registry, which `app.whenReady`
// initializes in production. Here the active workspace is the stored vault folder, as before
// workspaces, so a test can still point it at an unreachable path.
vi.mock("../workspaces", async () => {
  const { vaultDirectory } = await import("../library/vault-location");
  return {
    requireCaptureWorkspace: async () => ({ path: vaultDirectory().path }),
    notifyWorkspaceBusyChanged: () => {},
  };
});

vi.mock("./camera-bubble-window", () => ({
  CameraBubbleWindow: class {
    show = mockState.bubble.show;
    hide = mockState.bubble.hide;
    destroy = mockState.bubble.destroy;
    isVisible = mockState.bubble.isVisible;
    visibleBounds = mockState.bubble.visibleBounds;
    anchorTo = mockState.bubble.anchorTo;
    raise = mockState.bubble.raise;
    applySize = mockState.bubble.applySize;
    preview = mockState.bubble.preview;
    applyProtection = mockState.bubble.applyProtection;
    constructor(_size: () => number, protect: () => boolean) {
      mockState.bubbleProtect = protect;
    }
  },
}));

vi.mock("./recording-shade-window", () => ({
  RecordingShadeWindow: class {
    show = mockState.shade.show;
    hide = mockState.shade.hide;
    update = mockState.shade.update;
    prewarm = mockState.shade.prewarm;
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
    webContents: { id: 1, send: vi.fn(), isDestroyed: () => false },
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

  it("starts with the microphone remembered in app settings", async () => {
    const { registerSettings, updateAppSettings } =
      await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const yeti = { deviceId: "yeti", label: "Yeti Nano" };
    updateAppSettings({ microphone: yeti });

    registerRecordingHub(() => fakeMainWindow() as never);
    const get = mockState.ipcHandle.get(IPC_CHANNELS.recordingSettingsGet);
    if (!get) throw new Error("recordingSettingsGet handler not registered");
    expect((get({}) as { selectedMicrophone: unknown }).selectedMicrophone).toEqual(yeti);
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

  it("hides the main window at the end of a countdown and says whether it was on screen", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    let visible = true;
    const mainWindow = {
      ...fakeMainWindow(),
      isVisible: () => visible,
      hide: vi.fn(() => (visible = false)),
    };
    registerRecordingHub(() => mainWindow as never);
    const hideMain = mockState.ipcHandle.get(IPC_CHANNELS.recordingHideMainWindow)!;

    // The Record page's countdown: the app was on screen, and the take must wait for it.
    expect(hideMain({})).toBe(true);
    expect(mainWindow.hide).toHaveBeenCalledOnce();
    // A region countdown: the app was already out of sight, nothing to wait for.
    expect(hideMain({})).toBe(false);
    expect(mainWindow.hide).toHaveBeenCalledOnce();
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

  describe("the bubble's position is recorded at finalize", () => {
    type Bounds = { x: number; y: number; width: number; height: number };
    const webcam = {
      startOffsetMs: 12,
      offsetQuality: "exact",
      width: 1280,
      height: 720,
      fps: 30,
      // The renderer's copy never carries a position; one it forged is replaced by main's.
      recordedLayout: {
        shape: "circle",
        size: 240,
        mirrored: true,
        framing: { enabled: false, zoom: 1, x: 0, y: 0 },
        position: { x: 0.99, y: 0.99 },
        sizeFraction: 0.99,
      },
    };
    const display1 = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
    const area = {
      displayId: 1,
      rect: { x: 100, y: 50, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };

    /** A take with a webcam, started on `sourceId`, finalized while the bubble is at `bubble`. */
    async function recordWithWebcam(options: {
      sourceId: string;
      withArea?: boolean;
      bubble: Bounds | null;
    }) {
      const { registerSettings } = await import("../infrastructure/settings-store");
      const { registerRecordingHub } = await import("./recording-hub");
      registerSettings();
      const hub = registerRecordingHub(() => fakeMainWindow() as never);
      mockState.displays = [display1];
      mockState.getSources.mockResolvedValue([
        { id: "screen:1:0", name: "Screen 1", display_id: "1" },
      ]);
      if (options.withArea) await hub.selectArea(1, area.rect);
      mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
        {},
        { sourceId: options.sourceId, sourceName: "S", ...(options.withArea ? { area } : {}) },
      );
      // The display lookup resolves the recorded rectangle of a whole-display take.
      await new Promise((r) => setTimeout(r, 0));
      const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
      const write = mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!;
      await create({}, "s1");
      await create({}, "s1", "webcam");
      write({}, "s1", new TextEncoder().encode("screen").buffer, 0);
      write({}, "s1", new TextEncoder().encode("face").buffer, 0, "webcam");
      mockState.bubble.visibleBounds.mockReturnValue(options.bubble);
      const recording = (await mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize)!({}, "s1", {
        title: "T",
        durationSeconds: 1,
        durationMs: 1000,
        webcam,
      })) as { webcam?: { recordedLayout?: Record<string, unknown> } };
      return recording.webcam?.recordedLayout;
    }

    it("normalizes the bubble to the area of an area take", async () => {
      // Bottom-left of the area (global x 100, y 50): 288 DIP window, 32 from the edges.
      const layout = await recordWithWebcam({
        sourceId: "screen:1:0",
        withArea: true,
        bubble: { x: 132, y: 90, width: 288, height: 288 },
      });
      expect(layout).toMatchObject({ position: { x: 0.275, y: 0.5111 }, sizeFraction: 0.6667 });
    });

    it("normalizes the bubble to the display of a whole-display take", async () => {
      const layout = await recordWithWebcam({
        sourceId: "screen:1:0",
        bubble: { x: 32, y: 662, width: 288, height: 288 },
      });
      expect(layout).toMatchObject({ position: { x: 0.1164, y: 0.8208 }, sizeFraction: 0.2444 });
    });

    it("leaves the position out when the bubble was not on screen, and drops the renderer's", async () => {
      const layout = await recordWithWebcam({ sourceId: "screen:1:0", bubble: null });
      expect(layout).toBeDefined();
      expect(layout).not.toHaveProperty("position");
      expect(layout).not.toHaveProperty("sizeFraction");
    });

    it("leaves the position out for a window take: its bounds are unknown", async () => {
      const layout = await recordWithWebcam({
        sourceId: "window:5:0",
        bubble: { x: 32, y: 662, width: 288, height: 288 },
      });
      expect(layout).not.toHaveProperty("position");
    });
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
    // The bar kept hidden from the last take was raised with the countdown: never leave it
    // reading "Starting…" over an idle app.
    expect(mockState.bar.hide).toHaveBeenCalled();
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

  it("a cursor track for a take that already ended is refused without a display lookup", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    mockState.getSources.mockClear();
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const trackStart = mockState.ipcHandle.get(IPC_CHANNELS.cursorTrackStart)!;
    const abort = mockState.ipcHandle.get(IPC_CHANNELS.recordingAbort)!;
    await create({}, "session-1");
    await abort({}, "session-1");

    await expect(trackStart({}, "session-1", "screen:1:0")).resolves.toEqual({ enabled: false });
    expect(mockState.getSources).not.toHaveBeenCalled();
  });

  it("a cursor track whose take finalized while its display resolved never starts sampling", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    let resolve!: (list: Array<{ id: string; name: string; display_id: string }>) => void;
    mockState.getSources.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const write = mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!;
    const finalize = mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize)!;
    const trackStart = mockState.ipcHandle.get(IPC_CHANNELS.cursorTrackStart)!;
    await create({}, "session-1");
    write({}, "session-1", new TextEncoder().encode("take").buffer, 0);

    // The renderer stopped waiting on the handshake (its 500 ms race) and the whole take ran.
    const started = trackStart({}, "session-1", "screen:1:0") as Promise<{ enabled: boolean }>;
    await finalize({}, "session-1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    resolve([{ id: "screen:1:0", name: "S", display_id: "1" }]);

    await expect(started).resolves.toEqual({ enabled: false });
  });

  it("a forced reset ends its open takes: a cursor track still resolving never starts", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    let resolve!: (list: Array<{ id: string; name: string; display_id: string }>) => void;
    mockState.getSources.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const trackStart = mockState.ipcHandle.get(IPC_CHANNELS.cursorTrackStart)!;
    await create({}, "session-1");

    // The renderer is gone (crash, hung at close): it will never abort or finalize this take.
    const started = trackStart({}, "session-1", "screen:1:0") as Promise<{ enabled: boolean }>;
    hub.forceReset();
    resolve([{ id: "screen:1:0", name: "S", display_id: "1" }]);

    await expect(started).resolves.toEqual({ enabled: false });
  });

  it("a take holds the vault from create through finalize: Fix all cannot start (C9, C10)", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    const { vaultActivity, VaultBusyError } = await import("../library/vault-activity");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const write = mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!;
    const finalize = mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize)!;
    await create({}, "session-1");
    write({}, "session-1", new TextEncoder().encode("take").buffer, 0);
    expect(vaultActivity.active()).toEqual(["recording"]);
    await expect(vaultActivity.enterMaintenance()).rejects.toBeInstanceOf(VaultBusyError);

    await finalize({}, "session-1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    expect(vaultActivity.active()).toEqual([]);
    (await vaultActivity.enterMaintenance())();
  });

  it("an aborted take and a forced reset release the vault; a take is refused during a fix", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    const { vaultActivity, MaintenanceError } = await import("../library/vault-activity");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const abort = mockState.ipcHandle.get(IPC_CHANNELS.recordingAbort)!;

    await create({}, "session-1");
    await abort({}, "session-1");
    expect(vaultActivity.active()).toEqual([]);

    await create({}, "session-2");
    hub.forceReset();
    await vi.waitFor(() => expect(vaultActivity.active()).toEqual([]));

    const exit = await vaultActivity.enterMaintenance();
    try {
      await expect(Promise.resolve().then(() => create({}, "session-3"))).rejects.toBeInstanceOf(
        MaintenanceError,
      );
    } finally {
      exit();
    }
    expect(vaultActivity.active()).toEqual([]);
  });

  it("a renderer reload keeps its take's partial, resets the recorder state and frees the vault", async () => {
    const { EventEmitter } = await import("node:events");
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    const { RecordingWriter } = await import("./recording-writer");
    const { vaultActivity } = await import("../library/vault-activity");
    registerSettings();
    const mainWindow = fakeMainWindow();
    registerRecordingHub(() => mainWindow as never);
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const write = mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!;
    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const getState = mockState.ipcHandle.get(IPC_CHANNELS.recordingGetState)!;
    const abort = vi.spyOn(RecordingWriter.prototype, "abort");
    const renderer = Object.assign(new EventEmitter(), { id: 41 });
    const event = { sender: renderer };
    try {
      // An in-page route change is not a reload: the take keeps its lease.
      const { tempPath } = (await create(event, "take-1")) as { tempPath: string };
      write(event, "take-1", new TextEncoder().encode("only copy").buffer, 0);
      start(event, { sourceId: "screen:1:0", sourceName: "Screen 1" });
      renderer.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
      renderer.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
      expect(vaultActivity.active()).toEqual(["recording"]);
      expect(getState({})).toMatchObject({ active: true });

      // A plain reload (no crash, no close) is not a discard: the bytes stay for the sweep.
      renderer.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      await vi.waitFor(() => expect(vaultActivity.active()).toEqual([]));
      expect(abort).not.toHaveBeenCalled();
      expect(await readFile(tempPath, "utf-8")).toBe("only copy");
      // The recorder that owned the bar is gone: the app is back as after a stop.
      expect(getState({})).toMatchObject({ active: false });
      expect(mockState.bar.hide).toHaveBeenCalled();
      expect(mainWindow.show).toHaveBeenCalled();

      // The reloaded page records again; its take holds the vault as usual.
      await create(event, "take-2");
      expect(vaultActivity.active()).toEqual(["recording"]);
      renderer.emit("destroyed");
      await vi.waitFor(() => expect(vaultActivity.active()).toEqual([]));
    } finally {
      abort.mockRestore();
    }
  });

  it("a take whose create is still opening its file holds the vault until that create settles", async () => {
    const { EventEmitter } = await import("node:events");
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    const { RecordingWriter } = await import("./recording-writer");
    const { vaultActivity, VaultBusyError } = await import("../library/vault-activity");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const abortIpc = mockState.ipcHandle.get(IPC_CHANNELS.recordingAbort)!;
    const release = vi.spyOn(RecordingWriter.prototype, "release");
    const abort = vi.spyOn(RecordingWriter.prototype, "abort");
    const renderer = Object.assign(new EventEmitter(), { id: 42 });
    const event = { sender: renderer };
    const realCreate = RecordingWriter.prototype.create;
    const holdCreate = () => {
      const gate: { open?: () => void } = {};
      vi.spyOn(RecordingWriter.prototype, "create").mockImplementationOnce(
        async function (this: InstanceType<typeof RecordingWriter>, id) {
          await new Promise<void>((resolve) => (gate.open = resolve));
          return realCreate.call(this, id);
        },
      );
      return gate;
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    try {
      // The page goes (several times: navigation, crash, destroy) while the file is opening.
      const gate = holdCreate();
      const created = Promise.resolve(create(event, "export-1")).catch((error: unknown) => error);
      await vi.waitFor(() => expect(gate.open).toBeTypeOf("function"));
      renderer.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      renderer.emit("render-process-gone");
      await settle();
      // Nothing is open yet, but the create is: Fix all must still be refused.
      expect(vaultActivity.active()).toEqual(["recording"]);
      await expect(vaultActivity.enterMaintenance()).rejects.toBeInstanceOf(VaultBusyError);
      gate.open!();
      expect(await created).toBeInstanceOf(Error);
      await vi.waitFor(() => expect(vaultActivity.active()).toEqual([]));
      // Ended once, by release (kept), never deleted.
      expect(release.mock.calls.filter(([id]) => id === "export-1")).toHaveLength(1);
      expect(abort).not.toHaveBeenCalled();

      // The user cancels while the file is opening: the abort waits for the create.
      const gate2 = holdCreate();
      const created2 = Promise.resolve(create(event, "export-2")).catch((error: unknown) => error);
      await vi.waitFor(() => expect(gate2.open).toBeTypeOf("function"));
      const aborted = Promise.resolve(abortIpc(event, "export-2"));
      await settle();
      expect(vaultActivity.active()).toEqual(["recording"]);
      gate2.open!();
      await aborted;
      await created2;
      expect(vaultActivity.active()).toEqual([]);
      expect(abort).toHaveBeenCalledWith("export-2", expect.stringContaining("export-2"));
    } finally {
      release.mockRestore();
      abort.mockRestore();
      vi.restoreAllMocks();
    }
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

  it("loads the shade window ahead of the first countdown", async () => {
    const { handle } = await hub();
    handle.prewarmShade();
    expect(mockState.shade.prewarm).toHaveBeenCalledTimes(1);
    expect(mockState.shade.show).not.toHaveBeenCalled();
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

  it("a forced reset releases the writer's open takes, so no file handle outlives the renderer", async () => {
    const { RecordingWriter } = await import("./recording-writer");
    const release = vi.spyOn(RecordingWriter.prototype, "release");
    try {
      const { handle } = await hub();
      const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
      const { tempPath } = (await create({}, "session-crashed")) as { tempPath: string };

      // The renderer crashed (or its window closed) mid-take: it will never finalize or abort.
      handle.forceReset();

      // Released once, bound to its own staging file.
      await vi.waitFor(() => expect(release).toHaveBeenCalledWith("session-crashed", tempPath));
      expect(release).toHaveBeenCalledOnce();
      await release.mock.results[0]!.value;
    } finally {
      release.mockRestore();
    }
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

  it("relays mic levels only to subscribed windows and tells the recorder who listens", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    registerRecordingHub(() => mainWindow as never);
    const panel = { id: 7, send: vi.fn(), once: vi.fn(), on: vi.fn(), isDestroyed: () => false };
    const other = { id: 8, send: vi.fn(), once: vi.fn(), on: vi.fn(), isDestroyed: () => false };
    const fromRecorder = { sender: mainWindow.webContents };
    const subscribe = mockState.ipcOn.get(IPC_CHANNELS.micLevelsSubscribe)!;
    const unsubscribe = mockState.ipcOn.get(IPC_CHANNELS.micLevelsUnsubscribe)!;
    const report = mockState.ipcOn.get(IPC_CHANNELS.micLevelsReport)!;
    const listening = mockState.ipcHandle.get(IPC_CHANNELS.micLevelsGetListening)!;

    expect(listening({})).toBe(false);
    subscribe({ sender: panel });
    expect(listening({})).toBe(true);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.micLevelsListening, true);

    report(fromRecorder, [0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(panel.send).toHaveBeenCalledWith(IPC_CHANNELS.micLevelsData, [0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(other.send).not.toHaveBeenCalled();
    // Rubbish from a renderer is dropped.
    report(fromRecorder, "loud");
    expect(panel.send).toHaveBeenCalledTimes(1);
    // Only the recorder reports levels: another window cannot drive the meter.
    report({ sender: other }, [1, 1, 1, 1, 1]);
    expect(panel.send).toHaveBeenCalledTimes(1);
    // Out-of-range values are clamped to the 0..1 a bar can show.
    report(fromRecorder, [-1, 2, 0.5, 0, 1]);
    expect(panel.send).toHaveBeenLastCalledWith(IPC_CHANNELS.micLevelsData, [0, 1, 0.5, 0, 1]);

    unsubscribe({ sender: panel });
    expect(mainWindow.webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.micLevelsListening,
      false,
    );
    report(fromRecorder, [0, 0, 0, 0, 0]);
    expect(panel.send).toHaveBeenCalledTimes(2);
  });

  it("clears a window's mic-level subscription when it is destroyed", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    let destroyed: () => void = () => {};
    const panel = {
      id: 9,
      send: vi.fn(),
      once: (_event: string, fn: () => void) => {
        destroyed = fn;
      },
      on: vi.fn(),
      isDestroyed: () => false,
    };
    mockState.ipcOn.get(IPC_CHANNELS.micLevelsSubscribe)!({ sender: panel });
    const listening = mockState.ipcHandle.get(IPC_CHANNELS.micLevelsGetListening)!;
    expect(listening({})).toBe(true);
    destroyed();
    expect(listening({})).toBe(false);
  });

  it("clears a window's mic-level subscriptions when it reloads or its renderer dies", async () => {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    const handlers = new Map<string, (details?: unknown) => void>();
    const panel = {
      id: 10,
      send: vi.fn(),
      once: vi.fn(),
      on: (event: string, fn: (details?: unknown) => void) => handlers.set(event, fn),
      isDestroyed: () => false,
    };
    const subscribe = mockState.ipcOn.get(IPC_CHANNELS.micLevelsSubscribe)!;
    const listening = mockState.ipcHandle.get(IPC_CHANNELS.micLevelsGetListening)!;

    subscribe({ sender: panel });
    // An in-page navigation or a subframe keeps the page, and its subscription.
    handlers.get("did-start-navigation")!({ isMainFrame: true, isSameDocument: true });
    handlers.get("did-start-navigation")!({ isMainFrame: false, isSameDocument: false });
    expect(listening({})).toBe(true);
    // A reload drops the page without running its cleanup.
    handlers.get("did-start-navigation")!({ isMainFrame: true, isSameDocument: false });
    expect(listening({})).toBe(false);

    subscribe({ sender: panel });
    subscribe({ sender: panel });
    handlers.get("render-process-gone")!();
    expect(listening({})).toBe(false);
  });
});

describe("recording hub — the webcam writer session (ADR 0037)", () => {
  async function registered() {
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    registerSettings();
    const mainWindow = fakeMainWindow();
    registerRecordingHub(() => mainWindow as never);
    return mainWindow;
  }

  it("forwards the kind to the writer on create, write and stat", async () => {
    const { RecordingWriter } = await import("./recording-writer");
    const create = vi.spyOn(RecordingWriter.prototype, "create").mockResolvedValue({
      tempPath: "/tmp/x",
    });
    const write = vi.spyOn(RecordingWriter.prototype, "write").mockResolvedValue();
    const stat = vi.spyOn(RecordingWriter.prototype, "stat").mockResolvedValue(3);
    try {
      await registered();
      const data = new ArrayBuffer(1);
      const createIpc = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
      // A webcam joins an open recording take: without one it is refused.
      await expect(createIpc({}, "s0", "webcam")).rejects.toThrow(/no recording take/);
      // An older caller sends no kind: the screen, as before.
      await createIpc({}, "s1");
      await createIpc({}, "s1", "webcam");
      await expect(createIpc({}, "s1", "webcam")).rejects.toThrow(/already has a webcam/);
      mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!({}, "s1", data, 4, "webcam");
      await mockState.ipcHandle.get(IPC_CHANNELS.recordingStat)!({}, "s1", "webcam");
      expect(create.mock.calls).toEqual([["s1"], ["s1", "webcam"]]);
      expect(write).toHaveBeenCalledWith("s1", data, 4, "webcam");
      expect(stat).toHaveBeenCalledWith("s1", "webcam");
    } finally {
      create.mockRestore();
      write.mockRestore();
      stat.mockRestore();
    }
  });

  it("a failed webcam write never stops the take; a failed screen write still does", async () => {
    const { RecordingWriter } = await import("./recording-writer");
    const write = vi
      .spyOn(RecordingWriter.prototype, "write")
      .mockRejectedValue(new Error("ENOSPC"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mainWindow = await registered();
      const onWrite = mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!;
      onWrite({}, "s1", new ArrayBuffer(1), 0, "webcam");
      await new Promise((r) => setTimeout(r, 0));
      expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(
        IPC_CHANNELS.recordingCommand,
        "stop",
      );
      onWrite({}, "s1", new ArrayBuffer(1), 0);
      await new Promise((r) => setTimeout(r, 0));
      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.recordingCommand,
        "stop",
      );
    } finally {
      write.mockRestore();
      error.mockRestore();
    }
  });

  describe("whether the bubble leaves the capture", () => {
    let create: { mockRestore(): void };
    beforeEach(async () => {
      const { RecordingWriter } = await import("./recording-writer");
      create = vi
        .spyOn(RecordingWriter.prototype, "create")
        .mockImplementation(async (_id: string, kind?: string) => {
          if (kind === "webcam" && failWebcamCreate) throw new Error("EACCES");
          return { tempPath: "/tmp/x" };
        });
      failWebcamCreate = false;
      mockState.bubble.applyProtection.mockClear();
    });
    afterEach(() => create.mockRestore());
    let failWebcamCreate = false;
    const ipc = async (channel: string, ...args: unknown[]): Promise<unknown> =>
      mockState.ipcHandle.get(channel)!({}, ...args);
    const protects = () => mockState.bubbleProtect!();

    it("protects it before a take and through a take that records a webcam file", async () => {
      await registered();
      expect(protects()).toBe(true);
      await ipc(IPC_CHANNELS.recordingCreate, "s1");
      await ipc(IPC_CHANNELS.recordingCreate, "s1", "webcam");
      expect(protects()).toBe(true);
      expect(mockState.bubble.applyProtection).toHaveBeenCalled();
    });

    it("leaves it in the capture during a take that started with the camera off", async () => {
      // The camera turned on mid-take: that take records no webcam file, so the bubble main
      // creates for it must be in the screen recording.
      await registered();
      await ipc(IPC_CHANNELS.recordingCreate, "s1");
      expect(protects()).toBe(false);
    });

    it("puts it back in the capture once the renderer reports the webcam ended", async () => {
      await registered();
      await ipc(IPC_CHANNELS.recordingCreate, "s1");
      await ipc(IPC_CHANNELS.recordingCreate, "s1", "webcam");
      mockState.bubble.applyProtection.mockClear();
      await ipc(IPC_CHANNELS.recordingWebcamEnded, "s1");
      expect(protects()).toBe(false);
      expect(mockState.bubble.applyProtection).toHaveBeenCalledOnce();
    });

    it("puts it back in the capture when the webcam session cannot be created", async () => {
      await registered();
      failWebcamCreate = true;
      await ipc(IPC_CHANNELS.recordingCreate, "s1");
      await expect(ipc(IPC_CHANNELS.recordingCreate, "s1", "webcam")).rejects.toThrow("EACCES");
      expect(protects()).toBe(false);
    });

    it("puts it back in the capture when a webcam write fails mid-take", async () => {
      const { RecordingWriter } = await import("./recording-writer");
      const write = vi
        .spyOn(RecordingWriter.prototype, "write")
        .mockRejectedValue(new Error("ENOSPC"));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await registered();
        await ipc(IPC_CHANNELS.recordingCreate, "s1");
        await ipc(IPC_CHANNELS.recordingCreate, "s1", "webcam");
        mockState.bubble.applyProtection.mockClear();
        mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!(
          {},
          "s1",
          new ArrayBuffer(1),
          0,
          "webcam",
        );
        await new Promise((r) => setTimeout(r, 0));
        // Finalize drops that webcam file: the face must be in the screen from here on.
        expect(protects()).toBe(false);
        expect(mockState.bubble.applyProtection).toHaveBeenCalled();
      } finally {
        write.mockRestore();
        error.mockRestore();
      }
    });

    describe("an export writing in the background is not a take", () => {
      let exports = 0;
      const exportDuring = async (): Promise<void> => {
        const { RecordingWriter } = await import("./recording-writer");
        const finalize = vi
          .spyOn(RecordingWriter.prototype, "finalize")
          .mockRejectedValue(new Error("no file"));
        // Each export is its own take id: main refuses an id that is still open.
        const id = `export-during-${++exports}`;
        try {
          await ipc(IPC_CHANNELS.recordingCreate, id, "export");
          await ipc(IPC_CHANNELS.recordingFinalize, id, { durationMs: 0 }).catch(() => {});
        } finally {
          finalize.mockRestore();
        }
      };

      it("leaves the bubble in the capture of a take without a webcam file", async () => {
        await registered();
        await ipc(IPC_CHANNELS.recordingCreate, "s1");
        await exportDuring();
        expect(protects()).toBe(false);
      });

      it("leaves the bubble out of the capture of a take with a webcam file", async () => {
        await registered();
        await ipc(IPC_CHANNELS.recordingCreate, "s1");
        await ipc(IPC_CHANNELS.recordingCreate, "s1", "webcam");
        await ipc(IPC_CHANNELS.recordingCreate, "export-1", "export");
        expect(protects()).toBe(true);
        await exportDuring();
        expect(protects()).toBe(true);
      });

      it("the live take's webcam end still applies after an export was created", async () => {
        await registered();
        await ipc(IPC_CHANNELS.recordingCreate, "s1");
        await ipc(IPC_CHANNELS.recordingCreate, "s1", "webcam");
        await ipc(IPC_CHANNELS.recordingCreate, "export-1", "export");
        await ipc(IPC_CHANNELS.recordingWebcamEnded, "s1");
        expect(protects()).toBe(false);
        // The export ending does not end the take either.
        await exportDuring();
        expect(protects()).toBe(false);
      });
    });

    it("protects it again when the take is finalized, aborted or reset", async () => {
      const { RecordingWriter } = await import("./recording-writer");
      const finalize = vi
        .spyOn(RecordingWriter.prototype, "finalize")
        .mockRejectedValue(new Error("no file"));
      const abort = vi.spyOn(RecordingWriter.prototype, "abort").mockResolvedValue();
      try {
        await registered();
        await ipc(IPC_CHANNELS.recordingCreate, "s1");
        await ipc(IPC_CHANNELS.recordingFinalize, "s1", { durationMs: 0 }).catch(() => {});
        expect(protects()).toBe(true);
        await ipc(IPC_CHANNELS.recordingCreate, "s2");
        await ipc(IPC_CHANNELS.recordingAbort, "s2");
        expect(protects()).toBe(true);
      } finally {
        finalize.mockRestore();
        abort.mockRestore();
      }
    });

    it("never protects it on Windows before 10 2004, whatever the take", async () => {
      await registered();
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      mockState.osRelease = "10.0.18363";
      try {
        expect(protects()).toBe(false);
      } finally {
        Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
        mockState.osRelease = "24.0.0";
      }
    });
  });

  describe("where the bubble cannot leave the capture", () => {
    afterEach(() => {
      Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
      mockState.osRelease = "24.0.0";
    });

    it("creates the webcam session on macOS and on a current Windows build", async () => {
      const { RecordingWriter } = await import("./recording-writer");
      const create = vi.spyOn(RecordingWriter.prototype, "create").mockResolvedValue({
        tempPath: "/tmp/x",
      });
      try {
        await registered();
        const handler = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
        Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
        await handler({}, "s1");
        await expect(handler({}, "s1", "webcam")).resolves.toBeDefined();
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        mockState.osRelease = "10.0.22631";
        await handler({}, "s2");
        await expect(handler({}, "s2", "webcam")).resolves.toBeDefined();
        expect(create.mock.calls).toEqual([["s1"], ["s1", "webcam"], ["s2"], ["s2", "webcam"]]);
      } finally {
        create.mockRestore();
      }
    });

    it("refuses the webcam session on Windows before 10 2004, and still creates the screen's", async () => {
      const { RecordingWriter } = await import("./recording-writer");
      const create = vi.spyOn(RecordingWriter.prototype, "create").mockResolvedValue({
        tempPath: "/tmp/x",
      });
      try {
        await registered();
        const handler = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        mockState.osRelease = "10.0.18363";
        await handler({}, "s1");
        // Electron turns a rejecting handler into a rejected `invoke` in the renderer.
        await expect(handler({}, "s1", "webcam")).rejects.toThrow(/webcam track unavailable/);
        // Marked, so the renderer tells the legacy path apart from a webcam that failed.
        await expect(handler({}, "s1", "webcam")).rejects.toThrow(WEBCAM_TRACK_UNSUPPORTED_MARKER);
        expect(create).toHaveBeenCalledExactlyOnceWith("s1");
      } finally {
        create.mockRestore();
      }
    });
  });
});

describe("recording hub — one lifecycle per take (NIW2-561)", () => {
  let vaultDir = "";

  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    vaultDir = join(mockState.userDataDir, "vault");
    await writeFile(
      join(mockState.userDataDir, "preferences.json"),
      JSON.stringify({ vaultDirectory: vaultDir }),
    );
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  async function setup(rendererId: number) {
    const { EventEmitter } = await import("node:events");
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    const { RecordingWriter } = await import("./recording-writer");
    const { LibraryVault } = await import("../library/library-vault");
    const activity = await import("../library/vault-activity");
    registerSettings();
    const hub = registerRecordingHub(() => fakeMainWindow() as never);
    const renderer = Object.assign(new EventEmitter(), { id: rendererId });
    const event = { sender: renderer };
    const reload = () =>
      renderer.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    return {
      hub,
      event,
      reload,
      RecordingWriter,
      LibraryVault,
      ...activity,
      create: mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!,
      write: mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!,
      finalize: mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize)!,
      abort: mockState.ipcHandle.get(IPC_CHANNELS.recordingAbort)!,
    };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  const gate = () => {
    const held: { open?: () => void; reached: boolean } = { reached: false };
    const wait = () => {
      held.reached = true;
      return new Promise<void>((resolve) => (held.open = resolve));
    };
    return { held, wait };
  };

  it("a take's webcam session shares its lifecycle: a reload keeps both parts, an abort deletes both", async () => {
    const t = await setup(71);
    const screen = (await t.create(t.event, "take-w")) as { tempPath: string };
    const webcam = (await t.create(t.event, "take-w", "webcam")) as { tempPath: string };
    expect(webcam.tempPath).toBe(screen.tempPath.replace(/\.mp4\.part$/, ".webcam.mp4.part"));
    t.reload();
    await settle();
    // Released, not discarded: both parts stay for the stranded-take sweep.
    expect(await readFile(screen.tempPath, "utf-8")).toBe("");
    expect(await readFile(webcam.tempPath, "utf-8")).toBe("");
    await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));

    const next = (await t.create(t.event, "take-x")) as { tempPath: string };
    const nextWebcam = (await t.create(t.event, "take-x", "webcam")) as { tempPath: string };
    await t.abort(t.event, "take-x");
    await expect(readFile(next.tempPath)).rejects.toThrow(/ENOENT/);
    await expect(readFile(nextWebcam.tempPath)).rejects.toThrow(/ENOENT/);
  });

  it.each(["before", "after"] as const)(
    "a reload %s finalize reserves its destination: the vault stays busy until finalize settles, and nothing is overwritten",
    async (when) => {
      const t = await setup(70);
      const { tempPath } = (await t.create(t.event, "take-1")) as { tempPath: string };
      t.write(t.event, "take-1", new TextEncoder().encode("only copy").buffer, 0);
      await vi.waitFor(async () => expect(await readFile(tempPath, "utf-8")).toBe("only copy"));
      const { held, wait } = gate();
      const reserve = t.LibraryVault.prototype.reserve;
      vi.spyOn(t.LibraryVault.prototype, "reserve").mockImplementationOnce(
        async function (this: InstanceType<typeof t.LibraryVault>, input) {
          if (when === "before") await wait();
          const reservation = await reserve.call(this, input);
          if (when === "after") await wait();
          return reservation;
        },
      );

      const finalized = Promise.resolve(
        t.finalize(t.event, "take-1", { title: "Race", durationSeconds: 1, durationMs: 1000 }),
      );
      await vi.waitFor(() => expect(held.reached).toBe(true));
      t.reload();
      await settle();

      // The page is gone, but its finalize is not: Fix all must not start (it would orphan
      // the reservation and hand its stem to another recording).
      expect(t.vaultActivity.active()).toEqual(["recording"]);
      await expect(t.vaultActivity.enterMaintenance()).rejects.toBeInstanceOf(t.VaultBusyError);

      held.open!();
      await expect(finalized).resolves.toMatchObject({ id: "Race" });
      expect(await readFile(join(vaultDir, "Race.mp4"), "utf-8")).toBe("only copy");
      await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));
      (await t.vaultActivity.enterMaintenance())();
    },
  );

  it("a reload during the cursor-track write keeps the vault busy until the write settles", async () => {
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    mockState.getSources.mockResolvedValue([{ id: "screen:1:0", name: "S", display_id: "1" }]);
    const t = await setup(71);
    await t.create(t.event, "take-1");
    t.write(t.event, "take-1", new TextEncoder().encode("take").buffer, 0);
    const trackStart = mockState.ipcHandle.get(IPC_CHANNELS.cursorTrackStart)!;
    await expect(trackStart(t.event, "take-1", "screen:1:0")).resolves.toEqual({ enabled: true });
    mockState.ipcOn.get(IPC_CHANNELS.cursorTrackAnchor)!(t.event, "take-1", 0, "exact");
    const { held, wait } = gate();
    const writeTrack = t.LibraryVault.prototype.writeCursorTrack;
    const spy = vi
      .spyOn(t.LibraryVault.prototype, "writeCursorTrack")
      .mockImplementationOnce(async function (this: InstanceType<typeof t.LibraryVault>, ...args) {
        await wait();
        return writeTrack.apply(this, args);
      });

    const finalized = Promise.resolve(
      t.finalize(t.event, "take-1", { title: "Track", durationSeconds: 1, durationMs: 1000 }),
    );
    await vi.waitFor(() => expect(held.reached).toBe(true));
    t.reload();
    await settle();
    expect(t.vaultActivity.active()).toEqual(["recording"]);
    await expect(t.vaultActivity.enterMaintenance()).rejects.toBeInstanceOf(t.VaultBusyError);

    held.open!();
    await finalized;
    expect(spy).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));
  });

  it("refuses a create reusing the id of a take still ending, and keeps that take's partial", async () => {
    const t = await setup(72);
    const { tempPath } = (await t.create(t.event, "same-id")) as { tempPath: string };
    t.write(t.event, "same-id", new TextEncoder().encode("only copy").buffer, 0);
    await vi.waitFor(async () => expect(await readFile(tempPath, "utf-8")).toBe("only copy"));
    const { held, wait } = gate();
    const release = t.RecordingWriter.prototype.release;
    const releaseSpy = vi
      .spyOn(t.RecordingWriter.prototype, "release")
      .mockImplementationOnce(
        async function (this: InstanceType<typeof t.RecordingWriter>, ...args) {
          await wait();
          return release.apply(this, args);
        },
      );

    t.reload();
    await vi.waitFor(() => expect(held.reached).toBe(true));
    await expect(Promise.resolve().then(() => t.create(t.event, "same-id"))).rejects.toThrow(
      /still open/,
    );
    expect(await readFile(tempPath, "utf-8")).toBe("only copy");

    held.open!();
    await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));
    expect(releaseSpy).toHaveBeenCalledWith("same-id", tempPath);
    expect(await readFile(tempPath, "utf-8")).toBe("only copy");
    // Once it has ended, the id is free again, with a staging file of its own.
    const again = (await t.create(t.event, "same-id")) as { tempPath: string };
    expect(again.tempPath).not.toBe(tempPath);
    await t.abort(t.event, "same-id");
    expect(await readFile(tempPath, "utf-8")).toBe("only copy");
  });

  it("an export abandoned by its page is discarded; a recording's partial is kept", async () => {
    const t = await setup(73);
    const recording = (await t.create(t.event, "session-1")) as { tempPath: string };
    const exported = (await t.create(t.event, "export-1", "export")) as { tempPath: string };
    t.write(t.event, "session-1", new TextEncoder().encode("recording").buffer, 0);
    t.write(t.event, "export-1", new TextEncoder().encode("export").buffer, 0);
    await vi.waitFor(async () => expect(await readFile(exported.tempPath, "utf-8")).toBe("export"));
    expect(t.vaultActivity.active().sort()).toEqual(["export", "recording"]);

    t.reload();
    await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));
    expect(await readFile(recording.tempPath, "utf-8")).toBe("recording");
    await expect(readFile(exported.tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("an export abandoned while its file opens is discarded once the create settles", async () => {
    const t = await setup(74);
    const { held, wait } = gate();
    const create = t.RecordingWriter.prototype.create;
    let tempPath = "";
    vi.spyOn(t.RecordingWriter.prototype, "create").mockImplementationOnce(
      async function (this: InstanceType<typeof t.RecordingWriter>, id) {
        await wait();
        const created = await create.call(this, id);
        tempPath = created.tempPath;
        return created;
      },
    );
    const created = Promise.resolve(t.create(t.event, "export-1", "export")).catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(held.reached).toBe(true));
    t.reload();
    await settle();
    expect(t.vaultActivity.active()).toEqual(["export"]);

    held.open!();
    expect(await created).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));
    await expect(readFile(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a forced reset discards an export's partial and keeps a recording's", async () => {
    const t = await setup(75);
    const recording = (await t.create(t.event, "session-1")) as { tempPath: string };
    const exported = (await t.create(t.event, "export-1", "export")) as { tempPath: string };
    t.write(t.event, "session-1", new TextEncoder().encode("recording").buffer, 0);
    t.write(t.event, "export-1", new TextEncoder().encode("export").buffer, 0);
    await vi.waitFor(async () =>
      expect(await readFile(recording.tempPath, "utf-8")).toBe("recording"),
    );

    t.hub.forceReset();
    await vi.waitFor(() => expect(t.vaultActivity.active()).toEqual([]));
    expect(await readFile(recording.tempPath, "utf-8")).toBe("recording");
    await expect(readFile(exported.tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("recording hub — an export whose finalize fails is discarded (NIW2-561)", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-hub-"));
    await writeFile(
      join(mockState.userDataDir, "preferences.json"),
      JSON.stringify({ vaultDirectory: join(mockState.userDataDir, "vault") }),
    );
    mockState.ipcOn.clear();
    mockState.ipcHandle.clear();
    mockState.showSaveDialog.mockReset();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  async function failedFinalize(kind: "export" | "recording", abandon: boolean) {
    const { EventEmitter } = await import("node:events");
    const { registerSettings } = await import("../infrastructure/settings-store");
    const { registerRecordingHub } = await import("./recording-hub");
    const { LibraryVault } = await import("../library/library-vault");
    const { vaultActivity } = await import("../library/vault-activity");
    registerSettings();
    registerRecordingHub(() => fakeMainWindow() as never);
    const renderer = Object.assign(new EventEmitter(), { id: 80 });
    const event = { sender: renderer };
    const create = mockState.ipcHandle.get(IPC_CHANNELS.recordingCreate)!;
    const write = mockState.ipcOn.get(IPC_CHANNELS.recordingWrite)!;
    const finalize = mockState.ipcHandle.get(IPC_CHANNELS.recordingFinalize)!;
    const abort = mockState.ipcHandle.get(IPC_CHANNELS.recordingAbort)!;

    const { tempPath } = (await create(event, "take-1", kind)) as { tempPath: string };
    write(event, "take-1", new TextEncoder().encode("partial").buffer, 0);
    await vi.waitFor(async () => expect(await readFile(tempPath, "utf-8")).toBe("partial"));
    vi.spyOn(LibraryVault.prototype, "reserve").mockRejectedValueOnce(new Error("no stem"));
    let answer!: (result: { canceled: boolean }) => void;
    mockState.showSaveDialog.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );

    const finalized = Promise.resolve(
      finalize(event, "take-1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(mockState.showSaveDialog).toHaveBeenCalledOnce());
    if (abandon) {
      renderer.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    }
    answer({ canceled: true });
    expect(await finalized).toBeInstanceOf(Error);
    if (!abandon) await abort(event, "take-1"); // the renderer aborts after a failed finalize
    await vi.waitFor(() => expect(vaultActivity.active()).toEqual([]));
    return tempPath;
  }

  it.each([true, false])(
    "an export's partial is deleted after a failed finalize and a cancelled dialog (page gone: %s)",
    async (abandon) => {
      const tempPath = await failedFinalize("export", abandon);
      await vi.waitFor(() => expect(readFile(tempPath)).rejects.toMatchObject({ code: "ENOENT" }));
    },
  );

  it.each([true, false])(
    "a recording's partial is kept after the same sequence (page gone: %s)",
    async (abandon) => {
      const tempPath = await failedFinalize("recording", abandon);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await readFile(tempPath, "utf-8")).toBe("partial");
    },
  );
});
