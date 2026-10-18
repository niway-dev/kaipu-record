import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import { CAPTURE_MODES } from "@shared/types/screenshot-capture";
import { useScreenshotMode } from "./use-screenshot-mode";

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  shortcuts: defaultShortcutsFor("darwin"),
};

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

function withStoredMode(mode: AppSettings["screenshotMode"]) {
  let settings: AppSettings = { ...BASE_SETTINGS, screenshotMode: mode };
  const updateSettings = vi.fn(async (patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  window.electronAPI = { ...realApi, getSettings: async () => settings, updateSettings };
  return updateSettings;
}

describe("useScreenshotMode", () => {
  it("reads the stored current mode", async () => {
    withStoredMode("frame");
    const { result } = renderHook(() => useScreenshotMode());
    expect(result.current.mode).toBe("frame"); // until the settings arrive
    await waitFor(() => expect(result.current.mode).toBe("frame"));
  });

  it("reads a stored mode other than the default", async () => {
    withStoredMode("screen");
    const { result } = renderHook(() => useScreenshotMode());
    await waitFor(() => expect(result.current.mode).toBe("screen"));
  });

  it("reads a stored Window mode as Window only while Window is enabled", async () => {
    withStoredMode("window");
    const on = renderHook(() => useScreenshotMode(CAPTURE_MODES));
    await waitFor(() => expect(on.result.current.mode).toBe("window"));
    // With the flag as shipped (off) the same stored value reads as Frame.
    const off = renderHook(() => useScreenshotMode());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(off.result.current.mode).toBe("frame");
  });

  it('never exposes a legacy "area" (or any unknown) stored mode: it reads as Frame', async () => {
    const getSettings = vi.fn(async () => ({
      ...BASE_SETTINGS,
      screenshotMode: "area" as never,
    }));
    window.electronAPI = { ...realApi, getSettings };
    const { result } = renderHook(() => useScreenshotMode());
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(result.current.mode).toBe("frame");
    window.electronAPI = {
      ...realApi,
      getSettings: async () => ({ ...BASE_SETTINGS, screenshotMode: "banana" as never }),
    };
    const other = renderHook(() => useScreenshotMode());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.result.current.mode).toBe("frame");
  });

  it("persists a new mode and skips a write for the current one", async () => {
    const updateSettings = withStoredMode("frame");
    const { result } = renderHook(() => useScreenshotMode());
    await waitFor(() => expect(result.current.mode).toBe("frame"));

    act(() => result.current.setMode("frame"));
    expect(updateSettings).not.toHaveBeenCalled();

    act(() => result.current.setMode("screen"));
    expect(updateSettings).toHaveBeenCalledWith({ screenshotMode: "screen" });
    await waitFor(() => expect(result.current.mode).toBe("screen"));
  });
});
