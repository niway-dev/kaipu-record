import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Mock the device-enumeration hook so useRecordingSetup never touches
// navigator.mediaDevices (absent in jsdom). Stable array via vi.hoisted.
const { MICS } = vi.hoisted(() => ({
  MICS: [{ deviceId: "m1", label: "Mic One" }],
}));
vi.mock("@renderer/features/recording/hooks/use-microphones", () => ({
  useMicrophones: () => MICS,
}));

import { useRecordingSetup } from "./use-recording-setup";

describe("useRecordingSetup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("defaults the selected microphone to the first device", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.selectedMicrophone).toEqual({ deviceId: "m1", label: "Mic One" });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.countdown).toBeNull();
  });

  it("can-start only once a source is selected", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.canStartRecording).toBe(false);
    act(() => result.current.selectSource({ id: "s1", name: "Display 1", type: "screen" }));
    expect(result.current.canStartRecording).toBe(true);
  });

  it("toggles capture flags", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.isMicrophoneEnabled).toBe(true);
    act(() => result.current.toggleMicrophone());
    expect(result.current.isMicrophoneEnabled).toBe(false);
  });

  it("counts down 3 → 2 → 1 and then starts recording", () => {
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.startRecording());
    expect(result.current.countdown).toBe(3);
    expect(result.current.isRecording).toBe(false);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(2);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBeNull();
    expect(result.current.isRecording).toBe(true);
  });

  it("stopRecording cancels an in-progress countdown", () => {
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.startRecording());
    expect(result.current.countdown).toBe(3);

    act(() => result.current.stopRecording());
    expect(result.current.countdown).toBeNull();
    expect(result.current.isRecording).toBe(false);

    // Any pending tick must not flip recording back on.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.isRecording).toBe(false);
  });
});
