import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, state } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  state: { windows: [] as unknown[] },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => state.windows },
}));

import { IPC_CHANNELS } from "@shared/types/ipc";
import { setLaunchAdminMode } from "./admin-mode";
import { registerAdminModeIpc } from "./admin-mode-ipc";

function fakeWindow(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } };
}

const mainContents = {};
const world = { session: null as { admin: boolean } | null, setting: false };
const setSetting = vi.fn((value: boolean) => {
  world.setting = value;
});
const relaunch = vi.fn();
const { notifyChanged } = registerAdminModeIpc({
  session: () => world.session,
  setting: () => world.setting,
  setSetting,
  relaunch,
  getMainWindow: () => ({ webContents: mainContents }) as never,
});

const call = (channel: string, ...args: unknown[]) =>
  handlers.get(channel)?.({ sender: mainContents }, ...args);
const callFrom = (sender: unknown, channel: string, ...args: unknown[]) =>
  handlers.get(channel)?.({ sender }, ...args);

describe("admin mode IPC", () => {
  beforeEach(() => {
    world.session = null;
    world.setting = false;
    state.windows = [];
    setLaunchAdminMode(false);
    setSetting.mockClear();
    relaunch.mockClear();
  });

  it("reads the state: stored permission, preference, launch value, pending restart", () => {
    setLaunchAdminMode(true);
    world.session = { admin: true };
    world.setting = true;
    expect(call(IPC_CHANNELS.adminModeGetState)).toEqual({
      isAdmin: true,
      adminModeSetting: true,
      effective: true,
      restartPending: false,
    });
  });

  it("signing out mid-session keeps effective and makes a restart pending (AC12)", () => {
    setLaunchAdminMode(true);
    world.session = { admin: true };
    world.setting = true;
    world.session = null; // signed out
    expect(call(IPC_CHANNELS.adminModeGetState)).toEqual({
      isAdmin: false,
      adminModeSetting: true,
      effective: true,
      restartPending: true,
    });
  });

  it("switching to a non-admin account mid-session behaves the same", () => {
    setLaunchAdminMode(true);
    world.setting = true;
    world.session = { admin: false };
    expect(call(IPC_CHANNELS.adminModeGetState)).toMatchObject({
      effective: true,
      restartPending: true,
    });
  });

  it("setting the preference writes it and answers with the state; effective stays", () => {
    world.session = { admin: true };
    expect(call(IPC_CHANNELS.adminModeSet, true)).toEqual({
      isAdmin: true,
      adminModeSetting: true,
      effective: false,
      restartPending: true,
    });
    expect(setSetting).toHaveBeenCalledWith(true);
  });

  it("ignores a value that is not a boolean", () => {
    world.session = { admin: true };
    expect(call(IPC_CHANNELS.adminModeSet, "true")).toMatchObject({ adminModeSetting: false });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("relaunches through the injected relaunch", () => {
    call(IPC_CHANNELS.adminModeRelaunch);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("refuses the two mutating calls from a window that is not the main one", () => {
    const other = {};
    expect(() => callFrom(other, IPC_CHANNELS.adminModeSet, true)).toThrow(/main window/);
    expect(() => callFrom(other, IPC_CHANNELS.adminModeRelaunch)).toThrow(/main window/);
    expect(setSetting).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    // The read stays open to every window.
    expect(callFrom(other, IPC_CHANNELS.adminModeGetState)).toMatchObject({ effective: false });
  });

  it("tells every open window when the state may have changed", () => {
    const [a, gone] = [fakeWindow(), fakeWindow(true)];
    state.windows = [a, gone];
    setLaunchAdminMode(true);
    world.session = { admin: true };
    world.setting = true;
    world.session = null;
    notifyChanged();
    expect(a.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.adminModeChanged, {
      isAdmin: false,
      adminModeSetting: true,
      effective: true,
      restartPending: true,
    });
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });
});
