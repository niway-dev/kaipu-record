import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";

const mockState = vi.hoisted(() => ({
  userDataDir: "",
  ipcOn: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  ipcHandle: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  setActivationPolicy: vi.fn(),
  dockShow: vi.fn(),
  bubble: { show: vi.fn(), hide: vi.fn(), destroy: vi.fn(), isVisible: vi.fn(() => false) },
  bar: { show: vi.fn(), hide: vi.fn(), send: vi.fn() },
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? mockState.userDataDir : "/tmp"),
    setActivationPolicy: mockState.setActivationPolicy,
    dock: { show: mockState.dockShow },
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
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  desktopCapturer: { getSources: vi.fn(async () => []) },
  systemPreferences: { isTrustedAccessibilityClient: () => false },
}));

vi.mock("./camera-bubble-window", () => ({
  CameraBubbleWindow: class {
    show = mockState.bubble.show;
    hide = mockState.bubble.hide;
    destroy = mockState.bubble.destroy;
    isVisible = mockState.bubble.isVisible;
  },
}));

vi.mock("./control-bar-window", () => ({
  ControlBarWindow: class {
    show = mockState.bar.show;
    hide = mockState.bar.hide;
    send = mockState.bar.send;
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
    ]) {
      fn.mockClear();
    }
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
