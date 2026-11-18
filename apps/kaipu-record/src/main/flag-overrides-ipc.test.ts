import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, state, applyImageTextOverride } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  state: { isPackaged: false, windows: [] as unknown[] },
  applyImageTextOverride: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
  },
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => state.windows },
}));
vi.mock("./screenshots/text-recognition-service", () => ({ applyImageTextOverride }));

import { IPC_CHANNELS } from "@shared/types/ipc";
import { activeFlagOverrides, setActiveFlagOverrides } from "./flag-overrides";
import { registerFlagOverridesIpc } from "./flag-overrides-ipc";

function fakeWindow(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } };
}

// Registered once: it subscribes to the module-level overrides, so each call would add a listener.
registerFlagOverridesIpc();

describe("registerFlagOverridesIpc", () => {
  beforeEach(() => {
    setActiveFlagOverrides({});
    state.isPackaged = false;
    state.windows = [];
    applyImageTextOverride.mockClear();
  });

  const set = (name: unknown, value: unknown) =>
    handlers.get(IPC_CHANNELS.flagOverrideSet)?.({}, name, value);

  it("pins the flag and sends the new overrides to every open window", () => {
    const [a, b, gone] = [fakeWindow(), fakeWindow(), fakeWindow(true)];
    state.windows = [a, b, gone];

    expect(set("image-canvas", true)).toEqual({ "image-canvas": true });

    expect(activeFlagOverrides()).toEqual({ "image-canvas": true });
    for (const window of [a, b]) {
      expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.flagOverridesChanged, {
        "image-canvas": true,
      });
    }
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });

  it("starts text recognition's warm-up for an image-text pin", () => {
    set("image-text", true);
    expect(applyImageTextOverride).toHaveBeenCalledWith(true);
  });

  it("refuses everything in a packaged app and tells no window", () => {
    state.isPackaged = true;
    const window = fakeWindow();
    state.windows = [window];
    expect(set("image-canvas", true)).toEqual({});
    expect(activeFlagOverrides()).toEqual({});
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("ignores an unknown flag", () => {
    const window = fakeWindow();
    state.windows = [window];
    expect(set("nope", true)).toEqual({});
    expect(window.webContents.send).not.toHaveBeenCalled();
  });
});
