import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSettings } from "@shared/types";
import { useRecordingSettings } from "./use-recording-settings";

const SETTINGS = (over: Partial<RecordingSettings> = {}): RecordingSettings => ({
  selectedSource: null,
  selectedMicrophone: null,
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
  ...over,
});

describe("useRecordingSettings", () => {
  let listeners: Array<(settings: RecordingSettings) => void>;

  beforeEach(() => {
    listeners = [];
    window.electronAPI.getRecordingSettings = vi.fn(
      async (): Promise<RecordingSettings> => SETTINGS(),
    );
    window.electronAPI.updateRecordingSettings = vi.fn();
    window.electronAPI.onRecordingSettingsChanged = vi.fn(
      (callback: (settings: RecordingSettings) => void) => {
        listeners.push(callback);
        return () => {};
      },
    );
  });

  it("adopts the settings queried on mount", async () => {
    window.electronAPI.getRecordingSettings = vi.fn(
      async (): Promise<RecordingSettings> => SETTINGS({ isCameraEnabled: true }),
    );
    const { result } = renderHook(() => useRecordingSettings());
    await waitFor(() => expect(result.current.isCameraEnabled).toBe(true));
  });

  it("updates optimistically and sends the patch to main", () => {
    const { result } = renderHook(() => useRecordingSettings());
    act(() => result.current.update({ isCameraEnabled: true }));
    expect(result.current.isCameraEnabled).toBe(true); // optimistic, before any broadcast
    expect(window.electronAPI.updateRecordingSettings).toHaveBeenCalledWith({
      isCameraEnabled: true,
    });
  });

  it("applies broadcast changes coming from other windows", async () => {
    const { result } = renderHook(() => useRecordingSettings());
    await waitFor(() => expect(listeners).toHaveLength(1));
    act(() => listeners[0](SETTINGS({ isSystemAudioEnabled: true })));
    expect(result.current.isSystemAudioEnabled).toBe(true);
  });
});
