import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AppSettings } from "@shared/types";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import { resetSettingsStoreForTests } from "@renderer/features/settings/settings-store";
import { useCameraSettings } from "./use-camera-settings";

const saved = {
  cameraBubble: {
    ...DEFAULT_CAMERA_BUBBLE,
    deviceId: "saved-cam",
    shape: "rounded",
    mirrored: true,
  },
} as unknown as AppSettings;

describe("useCameraSettings — a change made before the first read lands", () => {
  let resolveRead: (settings: AppSettings) => void;
  const updateSettings = vi.fn();

  beforeEach(() => {
    resetSettingsStoreForTests();
    updateSettings.mockReset();
    updateSettings.mockResolvedValue(saved);
    vi.stubGlobal("electronAPI", {
      getSettings: () =>
        new Promise<AppSettings>((resolve) => {
          resolveRead = resolve;
        }),
      onSettingsChanged: () => () => {},
      updateSettings,
    });
    window.electronAPI = globalThis.electronAPI as typeof window.electronAPI;
  });
  afterEach(() => {
    resetSettingsStoreForTests();
    vi.unstubAllGlobals();
  });

  it("is saved over the stored bubble when the popover closes before the read resolves", async () => {
    const { result, unmount } = renderHook(() => useCameraSettings());

    act(() => result.current.update({ mirrored: false }));
    unmount();
    expect(updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      resolveRead(saved);
      await Promise.resolve();
    });

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      cameraBubble: { ...saved.cameraBubble, mirrored: false },
    });
  });
});
