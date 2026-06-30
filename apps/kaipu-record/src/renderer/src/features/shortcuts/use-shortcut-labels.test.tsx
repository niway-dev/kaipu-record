import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShortcutLabels } from "./use-shortcut-labels";

describe("useShortcutLabels", () => {
  it("returns the bindings from settings as formatted labels", async () => {
    const { result } = renderHook(() => useShortcutLabels());
    // The test stub's settings carry DEFAULT_SHORTCUTS (Command+Control+C/S/O).
    await waitFor(() =>
      expect(result.current).toEqual({
        startRecording: "⌃⌘C",
        stopRecording: "⌃⌘S",
        bringToFront: "⌃⌘O",
        captureScreenshot: "⌃⌘X",
      }),
    );
  });

  it("re-reads when the window regains focus (reflects a rebind)", async () => {
    const shortcutsWith = (startRecording: string): { shortcuts: Record<string, string> } => ({
      shortcuts: {
        startRecording,
        stopRecording: "Command+Control+S",
        bringToFront: "Command+Control+O",
        captureScreenshot: "Command+Control+X",
      },
    });
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce(shortcutsWith("Command+Control+C"))
      .mockResolvedValueOnce(shortcutsWith("Command+Control+G"));
    window.electronAPI.getSettings =
      getSettings as unknown as typeof window.electronAPI.getSettings;

    const { result } = renderHook(() => useShortcutLabels());
    await waitFor(() => expect(result.current?.startRecording).toBe("⌃⌘C"));

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(result.current?.startRecording).toBe("⌃⌘G"));
  });
});
