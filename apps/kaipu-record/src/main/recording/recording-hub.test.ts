import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FINALIZE_ELSEWHERE_MARKER, FINALIZE_KEPT_MARKER, IPC_CHANNELS } from "@shared/types/ipc";

const mockState = vi.hoisted(() => ({
  userDataDir: "",
  ipcOn: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  ipcHandle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
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
  },
  bar: { show: vi.fn(), hide: vi.fn(), send: vi.fn(), raise: vi.fn() },
  shade: { show: vi.fn(), hide: vi.fn() },
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
  },
  dialog: { showSaveDialog: mockState.showSaveDialog },
  desktopCapturer: { getSources: mockState.getSources },
  systemPreferences: { isTrustedAccessibilityClient: () => false },
}));

vi.mock("./camera-bubble-window", () => ({
  CameraBubbleWindow: class {
    show = mockState.bubble.show;
    hide = mockState.bubble.hide;
    destroy = mockState.bubble.destroy;
    isVisible = mockState.bubble.isVisible;
    anchorTo = mockState.bubble.anchorTo;
    raise = mockState.bubble.raise;
  },
}));

vi.mock("./recording-shade-window", () => ({
  RecordingShadeWindow: class {
    show = mockState.shade.show;
    hide = mockState.shade.hide;
  },
}));

vi.mock("./control-bar-window", () => ({
  ControlBarWindow: class {
    show = mockState.bar.show;
    hide = mockState.bar.hide;
    send = mockState.bar.send;
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
    registerRecordingHub(() => fakeMainWindow() as never);
    const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
    mockState.displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }, display];
    const area = {
      displayId: 2,
      rect: { x: 100, y: 50, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };

    const start = mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!;
    const stop = mockState.ipcOn.get(IPC_CHANNELS.recordingStop)!;
    start({}, { sourceId: "screen:2:0", sourceName: "Area · 640 × 360", area });

    expect(mockState.shade.show).toHaveBeenCalledWith(display, area.rect, expect.any(Function));
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

  it("a full-display recording shows no shade and leaves the bubble where it was", async () => {
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

  it("a settings patch from a window cannot set an area that is malformed or off its display", async () => {
    const { settings } = await hub();
    const update = mockState.ipcOn.get(IPC_CHANNELS.recordingSettingsUpdate)!;

    update({}, { area: { displayId: 2, rect: { x: 0, y: 0, width: 0, height: 0 } } });
    expect(settings().area).toBeNull();

    update({}, { area: { displayId: 2, rect: { x: -500, y: 0, width: 5000, height: 400 } } });
    expect(settings().area).toEqual({
      displayId: 2,
      rect: { x: 0, y: 0, width: 1512, height: 400 },
      displaySize: { width: 1512, height: 982 },
    });
  });

  it("a recording start clamps its area before the shade and the bubble use it", async () => {
    await hub();
    mockState.shade.show.mockReset();
    mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!(
      {},
      {
        sourceId: "screen:2:0",
        sourceName: "Area",
        area: {
          displayId: 2,
          rect: { x: 1400, y: 0, width: 640, height: 360 },
          displaySize: { width: 1512, height: 982 },
        },
      },
    );
    // 1400 + 640 runs off a 1512-wide display: only 112 DIP of it is on screen.
    expect(mockState.shade.show).toHaveBeenCalledWith(
      display,
      { x: 1400, y: 0, width: 112, height: 360 },
      expect.any(Function),
    );
  });

  it("an area smaller than the minimum is refused", async () => {
    const { handle } = await hub();
    expect(await handle.selectArea(2, { x: 0, y: 0, width: 63, height: 400 })).toBe(false);
  });
});
