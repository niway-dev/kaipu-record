import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { useShortcutLabels } from "./use-shortcut-labels";

const settingsWith = (startRecording: string): AppSettings =>
  ({
    shortcuts: {
      startRecording,
      stopRecording: "Command+Control+S",
      bringToFront: "Command+Control+O",
      captureScreenshot: "Command+Control+X",
    },
  }) as AppSettings;

describe("useShortcutLabels", () => {
  it("returns the bindings from settings as formatted labels", async () => {
    const { result } = renderHook(() => useShortcutLabels());
    // The test stub's settings carry DEFAULT_SHORTCUTS (Command+Control+C/S/O/X).
    await waitFor(() =>
      expect(result.current).toEqual({
        startRecording: "⌃⌘C",
        stopRecording: "⌃⌘S",
        bringToFront: "⌃⌘O",
        captureScreenshot: "⌃⌘X",
      }),
    );
  });

  it("updates on a settings-changed broadcast (reflects a rebind without a remount/focus)", async () => {
    window.electronAPI.getSettings = vi.fn(async () =>
      settingsWith("Command+Control+C"),
    ) as unknown as typeof window.electronAPI.getSettings;
    let subscriber: ((settings: AppSettings) => void) | null = null;
    window.electronAPI.onSettingsChanged = ((callback: (settings: AppSettings) => void) => {
      subscriber = callback;
      return () => {};
    }) as unknown as typeof window.electronAPI.onSettingsChanged;

    const { result } = renderHook(() => useShortcutLabels());
    await waitFor(() => expect(result.current?.startRecording).toBe("⌃⌘C"));

    // The always-alive control-bar window never remounts/focuses; the broadcast
    // is what keeps its Stop-shortcut hint current.
    act(() => subscriber?.(settingsWith("Command+Control+G")));
    await waitFor(() => expect(result.current?.startRecording).toBe("⌃⌘G"));
  });
});
