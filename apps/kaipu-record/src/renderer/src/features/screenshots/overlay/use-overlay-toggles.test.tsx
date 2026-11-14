import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecordingSettings } from "@shared/types/ipc";
import { useOverlayToggles, type RecordingTogglesApi } from "./use-overlay-toggles";

const off = {
  isMicrophoneEnabled: false,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
} as RecordingSettings;

/** A fake bridge whose first settings read stays pending until the test settles it. */
function pendingRead() {
  let resolveRead: (settings: RecordingSettings) => void = () => {};
  let broadcast: (settings: RecordingSettings) => void = () => {};
  const api = {
    getRecordingSettings: vi.fn(
      () => new Promise<RecordingSettings>((resolve) => (resolveRead = resolve)),
    ),
    updateRecordingSettings: vi.fn(),
    onRecordingSettingsChanged: vi.fn((callback: (settings: RecordingSettings) => void) => {
      broadcast = callback;
      return () => {};
    }),
  } as unknown as RecordingTogglesApi;
  return {
    api,
    settle: (settings: RecordingSettings) => resolveRead(settings),
    broadcast: (settings: RecordingSettings) => broadcast(settings),
  };
}

describe("useOverlayToggles — the first read racing a change", () => {
  it("keeps a toggle pressed before the first read answered", async () => {
    const bridge = pendingRead();
    const { result } = renderHook(() => useOverlayToggles(bridge.api));

    act(() => {
      result.current.toggle("isMicrophoneEnabled");
    });
    expect(result.current.microphone).toBe(true);

    // The reply was computed before the press: it must not undo it.
    await act(async () => bridge.settle(off));
    expect(result.current.microphone).toBe(true);

    // The next press flips what the user sees, not a stale snapshot.
    act(() => {
      result.current.toggle("isMicrophoneEnabled");
    });
    expect(bridge.api.updateRecordingSettings).toHaveBeenLastCalledWith({
      isMicrophoneEnabled: false,
    });
    expect(result.current.microphone).toBe(false);
  });

  it("keeps a broadcast that landed before the first read answered", async () => {
    const bridge = pendingRead();
    const { result } = renderHook(() => useOverlayToggles(bridge.api));

    act(() => bridge.broadcast({ ...off, isSystemAudioEnabled: true }));
    await act(async () => bridge.settle(off));

    expect(result.current.systemAudio).toBe(true);
  });

  it("applies the first read when nothing changed meanwhile", async () => {
    const bridge = pendingRead();
    const { result } = renderHook(() => useOverlayToggles(bridge.api));

    await act(async () => bridge.settle({ ...off, isCameraEnabled: true }));

    expect(result.current.camera).toBe(true);
  });
});
