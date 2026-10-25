import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { AppSettings } from "@shared/types/ipc";

const mockState = vi.hoisted(() => ({
  userDataDir: "",
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  /** What AppKit would report: the process' real activation policy. */
  dockVisible: true,
  setActivationPolicy: vi.fn(),
  dockShow: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? mockState.userDataDir : "/tmp"),
    setActivationPolicy: mockState.setActivationPolicy,
    dock: { show: mockState.dockShow, isVisible: () => mockState.dockVisible },
    setLoginItemSettings: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mockState.handlers.set(channel, fn);
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

type Store = typeof import("./settings-store");

const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

/** A fresh module instance per test: the last-applied policy is module state. */
async function loadStore(): Promise<Store> {
  vi.resetModules();
  return import("./settings-store");
}

function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const handler = mockState.handlers.get(IPC_CHANNELS.updateSettings);
  if (!handler) throw new Error("updateSettings handler not registered");
  return handler({}, patch) as AppSettings;
}

describe("activation policy (macOS Dock + Cmd+Tab)", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-settings-"));
    mockState.handlers.clear();
    mockState.setActivationPolicy.mockReset();
    mockState.setActivationPolicy.mockImplementation((policy: string) => {
      mockState.dockVisible = policy === "regular";
    });
    mockState.dockShow.mockClear();
    mockState.dockVisible = true;
    setPlatform("darwin");
  });

  afterEach(async () => {
    setPlatform(realPlatform);
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("applies the persisted policy once at registration", async () => {
    const store = await loadStore();
    store.registerSettings();
    expect(mockState.setActivationPolicy).toHaveBeenCalledTimes(1);
    expect(mockState.setActivationPolicy).toHaveBeenCalledWith("regular");
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);
  });

  it("re-asserting an unchanged policy touches no AppKit state", async () => {
    // Each `app.dock.show()` on an active app orders every window out and back in
    // on macOS (the blur → hide → show the owner saw). Re-asserting the policy
    // must therefore be free when nothing changed.
    const store = await loadStore();
    store.registerSettings();
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();

    store.applyDockPolicy();
    store.applyDockPolicy();
    store.forceRegularPolicy();
    updateSettings({ launchAtLogin: true });

    expect(mockState.setActivationPolicy).not.toHaveBeenCalled();
    expect(mockState.dockShow).not.toHaveBeenCalled();
  });

  it("still transitions when the setting actually changes", async () => {
    const store = await loadStore();
    store.registerSettings();
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();

    updateSettings({ showInDock: false });
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("accessory");
    expect(mockState.dockShow).not.toHaveBeenCalled();

    updateSettings({ showInDock: true });
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("regular");
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);
    expect(mockState.setActivationPolicy).toHaveBeenCalledTimes(2);
  });

  it("forces regular for a recording and restores the preference afterwards", async () => {
    const store = await loadStore();
    store.registerSettings();
    updateSettings({ showInDock: false });
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();

    store.forceRegularPolicy();
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("regular");
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);

    // A second force (e.g. a second recording without a stop in between) is a no-op.
    store.forceRegularPolicy();
    expect(mockState.setActivationPolicy).toHaveBeenCalledTimes(1);

    store.applyDockPolicy();
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("accessory");
    expect(mockState.setActivationPolicy).toHaveBeenCalledTimes(2);
  });

  it("restores regular when something outside this module hid the Dock", async () => {
    // Electron's `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })`
    // runs `app.dock.hide()` unless `skipTransformProcessType` is set, so the
    // process can be an accessory app while this module still remembers
    // "regular". A re-assertion must then be a real transition, not a no-op —
    // the cache alone left the app out of Cmd+Tab until the user toggled the
    // Dock setting off and on (backlog/bug-app-lost-from-app-switcher, ADR 0029).
    const store = await loadStore();
    store.registerSettings();
    mockState.setActivationPolicy.mockClear();
    mockState.dockShow.mockClear();

    mockState.dockVisible = false; // the external DockHide
    store.applyDockPolicy();
    expect(mockState.setActivationPolicy).toHaveBeenLastCalledWith("regular");
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);

    // Reality matches again: idempotent as before.
    store.applyDockPolicy();
    store.forceRegularPolicy();
    expect(mockState.setActivationPolicy).toHaveBeenCalledTimes(1);
    expect(mockState.dockShow).toHaveBeenCalledTimes(1);
  });

  it("does nothing off macOS", async () => {
    setPlatform("win32");
    const store = await loadStore();
    store.registerSettings();
    store.applyDockPolicy();
    store.forceRegularPolicy();
    expect(mockState.setActivationPolicy).not.toHaveBeenCalled();
    expect(mockState.dockShow).not.toHaveBeenCalled();
  });
});

describe("updateAppSettings (main-side writers)", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-settings-"));
    mockState.handlers.clear();
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("persists the current screenshot mode, notifies listeners, and survives a reload", async () => {
    const store = await loadStore();
    store.registerSettings();
    const seen: string[] = [];
    store.onSettingsChanged((settings) => seen.push(settings.screenshotMode));

    expect(store.getAppSettings().screenshotMode).toBe("frame");
    expect(store.updateAppSettings({ screenshotMode: "screen" }).screenshotMode).toBe("screen");
    expect(seen).toEqual(["screen"]);

    const reloaded = await loadStore();
    reloaded.registerSettings();
    expect(reloaded.getAppSettings().screenshotMode).toBe("screen");
  });
});
